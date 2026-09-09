#!/usr/bin/env python3
"""Verify real TLS TURN authentication and private-peer denial, without sending media."""
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

MAGIC = 0x2112A442
HOST = "turn.gonota.ca"
api = runpy.run_path(str(Path(__file__).with_name("provision-signing-turn.py")))["aws"]


def attr(kind, value):
    return struct.pack("!HH", kind, len(value)) + value + bytes((-len(value)) % 4)


def exact(stream, count):
    result = b""
    while len(result) < count:
        chunk = stream.recv(count - len(result))
        if not chunk:
            raise RuntimeError("TURN connection closed")
        result += chunk
    return result


def message(stream, kind, body, key=None):
    transaction = secrets.token_bytes(12)
    header = struct.pack("!HHI12s", kind, len(body) + (24 if key else 0), MAGIC, transaction)
    data = header + body
    if key:
        data += attr(0x0008, hmac.new(key, data, hashlib.sha1).digest())
    stream.sendall(data)
    header = exact(stream, 20)
    response, size, magic, returned = struct.unpack("!HHI12s", header)
    if magic != MAGIC or returned != transaction:
        raise RuntimeError("Unexpected TURN response binding")
    body = exact(stream, size)
    attributes = {}
    offset = 0
    while offset < len(body):
        attribute, length = struct.unpack("!HH", body[offset:offset + 4])
        attributes[attribute] = body[offset + 4:offset + 4 + length]
        offset += 4 + length + (-length) % 4
    return response, attributes


def code(attributes):
    value = attributes.get(0x0009)
    return (value[2] & 7) * 100 + value[3] if value else None


def main():
    secret = api("aws-prod", "ssm", "get-parameter", Name="/nota/production/signing/turn-secret",
                 WithDecryption=True)["Parameter"]["Value"]
    username = f"{int(time.time()) + 1800}:permission-check:{secrets.token_hex(4)}"
    credential = base64.b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
    raw = socket.create_connection((HOST, 443), timeout=15)
    with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as stream:
        transport = attr(0x0019, b"\x11\0\0\0")
        response, attributes = message(stream, 0x0003, transport)
        if code(attributes) != 401:
            raise RuntimeError("Anonymous allocation did not receive an authentication challenge")
        realm, nonce = attributes[0x0014], attributes[0x0015]
        identity = attr(0x0006, username.encode()) + attr(0x0014, realm) + attr(0x0015, nonce)
        key = hashlib.md5(username.encode() + b":" + realm + b":" + credential.encode()).digest()
        _, attributes = message(stream, 0x0003, attr(0x0019, b"\x06\0\0\0") + identity, key)
        if code(attributes) != 442:
            raise RuntimeError("TCP peer relay was not rejected")
        response, _ = message(stream, 0x0003, transport + identity, key)
        if response != 0x0103:
            raise RuntimeError("Authenticated TLS allocation failed")
        observations = []
        try:
            # The mapped relay address needs a port-level kernel boundary;
            # check-signing-turn-peer-guard.py proves that separate control.
            for address in ["127.0.0.1", "169.254.169.254", "10.98.0.1", "172.16.0.1", "192.168.1.1", "100.64.0.1"]:
                value = struct.pack("!BBHI", 0, 1, 9 ^ (MAGIC >> 16), int(ipaddress.ip_address(address)) ^ MAGIC)
                response, attributes = message(stream, 0x0008, attr(0x0012, value) + identity, key)
                if code(attributes) != 403:
                    raise RuntimeError(f"Private-peer permission was not denied for {address}")
                observations.append({"peer": address, "denied": True, "code": 403})
            print(json.dumps({"tlsCertificateVerified": True, "anonymousAllocationRejected": True,
                              "tcpPeerRelayRejected": True, "authenticatedAllocationSucceeded": True,
                              "privatePeers": observations}, indent=2))
        finally:
            message(stream, 0x0004, attr(0x000D, struct.pack("!I", 0)) + identity, key)


if __name__ == "__main__":
    main()
