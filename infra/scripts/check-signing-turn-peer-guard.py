#!/usr/bin/env python3
"""Prove authenticated TURN cannot deliver to an otherwise live private service.

Creates one temporary UDP canary on the dedicated relay through SSM, outside
the reserved relay range. No SG ingress is opened. Secrets stay in memory.
"""
import base64
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import runpy
import secrets
import socket
import ssl
import struct
import time

library = runpy.run_path(str(Path(__file__).with_name("check-signing-turn-permissions.py")))
api, attr, message, code = (library[key] for key in ["api", "attr", "message", "code"])
MAGIC = library["MAGIC"]
INSTANCE = "i-0b4ef082546b9fbfb"
PRIVATE, PUBLIC, HOST = "10.98.0.30", "35.182.162.25", "turn.gonota.ca"


def remote(script):
    command = api("aws-prod", "ssm", "send-command", InstanceIds=[INSTANCE],
                  DocumentName="AWS-RunShellScript", Parameters={"commands": [script]}, TimeoutSeconds=90)
    command_id = command["Command"]["CommandId"]
    for _ in range(50):
        time.sleep(0.5)
        response = api("aws-prod", "ssm", "get-command-invocation", CommandId=command_id, InstanceId=INSTANCE)
        if response["Status"] == "Success":
            return json.loads(response["StandardOutputContent"])
        if response["Status"] not in ["Pending", "InProgress", "Delayed"]:
            raise RuntimeError("Private canary SSM command failed: " + response["Status"] + " (" + command_id + ")")
    raise RuntimeError("Private canary SSM command timed out")


def peer(address, port):
    return attr(0x0012, struct.pack("!BBHI", 0, 1, port ^ (MAGIC >> 16),
                                 int(ipaddress.ip_address(address)) ^ MAGIC))


def main():
    probe = secrets.token_hex(8)
    state = "/run/nota-turn-canary-" + probe + ".json"
    marker = ("nota-private-service-probe-" + probe).encode()
    canary = f"""
import socket,time,json,os
from pathlib import Path
path=Path({state!r}); marker={marker!r}; os.umask(0o077)
sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
for port in range(55000,57000):
 try: sock.bind(({PRIVATE!r},port)); break
 except OSError: continue
else: raise SystemExit('No canary port')
sock.settimeout(0.2)
result={{'phase':'ready','port':port,'controls':0,'turnPackets':0}}
temporary=path.with_suffix('.tmp')
temporary.write_text(json.dumps(result)); temporary.replace(path)
control=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
control.sendto(marker+b'-control',({PRIVATE!r},port)); control.close()
end=time.monotonic()+30
while time.monotonic()<end:
 try: payload,_=sock.recvfrom(4096)
 except TimeoutError: continue
 if payload==marker+b'-control': result['controls']+=1
 elif payload==marker: result['turnPackets']+=1
sock.close(); result['phase']='done'
temporary.write_text(json.dumps(result)); temporary.replace(path)
"""
    setup = remote(f"""python3 - <<'PY'
import json,subprocess,time
from pathlib import Path
subprocess.Popen(['python3','-c',{canary!r}],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
path=Path({state!r})
for _ in range(100):
 if path.exists():break
 time.sleep(0.05)
result=json.loads(path.read_text())
rules=json.loads(subprocess.check_output(['nft','-j','list','chain','inet','nota_turn_peer_guard','output']))
result['drops']=sum(expr['counter']['packets'] for item in rules['nftables'] for expr in item.get('rule',{{}}).get('expr',[]) if 'counter' in expr)
print(json.dumps(result))
PY""")
    secret = api("aws-prod", "ssm", "get-parameter", Name="/nota/production/signing/turn-secret",
                 WithDecryption=True)["Parameter"]["Value"]
    username = f"{int(time.time()) + 1800}:peer-guard-check:{probe}"
    credential = base64.b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
    raw = socket.create_connection((HOST, 443), timeout=15)
    with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as stream:
        transport = attr(0x0019, b"\x11\0\0\0")
        _, challenge = message(stream, 0x0003, transport)
        if code(challenge) != 401:
            raise RuntimeError("Expected authentication challenge")
        realm, nonce = challenge[0x0014], challenge[0x0015]
        identity = attr(0x0006, username.encode()) + attr(0x0014, realm) + attr(0x0015, nonce)
        key = hashlib.md5(username.encode() + b":" + realm + b":" + credential.encode()).digest()
        response, _ = message(stream, 0x0003, transport + identity, key)
        if response != 0x0103:
            raise RuntimeError("Authenticated allocation failed")
        try:
            for address in [PRIVATE, PUBLIC]:
                endpoint = peer(address, setup["port"])
                response, _ = message(stream, 0x0008, endpoint + identity, key)
                if response != 0x0108:
                    raise RuntimeError("Expected coarse mapped-address permission for the canary")
                response, _ = message(stream, 0x0009, attr(0x000C, struct.pack("!HH", 0x4000, 0)) + endpoint + identity, key)
                if response != 0x0109:
                    raise RuntimeError("Canary ChannelBind failed")
                for _ in range(2):
                    body = endpoint + attr(0x0013, marker)
                    stream.sendall(struct.pack("!HHI12s", 0x0016, len(body), MAGIC, secrets.token_bytes(12)) + body)
                    stream.sendall(struct.pack("!HH", 0x4000, len(marker)) + marker + bytes((-len(marker)) % 4))
                    time.sleep(0.1)
        finally:
            message(stream, 0x0004, attr(0x000D, struct.pack("!I", 0)) + identity, key)
    result = remote(f"""python3 - <<'PY'
import json,socket,time,subprocess
from pathlib import Path
path=Path({state!r}); marker={marker!r}
control=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
control.sendto(marker+b'-control',({PRIVATE!r},{setup['port']})); control.close()
for _ in range(200):
 result=json.loads(path.read_text())
 if result['phase']=='done':break
 time.sleep(0.2)
rules=json.loads(subprocess.check_output(['nft','-j','list','chain','inet','nota_turn_peer_guard','output']))
result['drops']=sum(expr['counter']['packets'] for item in rules['nftables'] for expr in item.get('rule',{{}}).get('expr',[]) if 'counter' in expr)
print(json.dumps(result)); path.unlink()
PY""")
    blocked = result["drops"] - setup["drops"]
    if result["phase"] != "done" or result["controls"] < 2 or result["turnPackets"] or blocked < 8:
        raise RuntimeError("Private service boundary failed: " + json.dumps({**result, "newDrops": blocked}))
    print(json.dumps({"tlsCertificateVerified": True, "privateAndPublicAliasTested": True,
                      "sendIndicationAndChannelDataTested": True, "positiveControlsReceived": result["controls"],
                      "privateServicePacketsReceived": 0, "kernelPacketsDropped": blocked}, indent=2))


if __name__ == "__main__":
    main()
