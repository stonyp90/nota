#!/usr/bin/env python3
"""Provision only the isolated Canadian signing TURN resources.

Run plan, review its resource/action list, then apply that exact saved plan.
Secrets use a transient mode-0600 request file and never enter Terraform or logs.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / "infra"
ACCOUNT = "436136277668"
REGION = "ca-central-1"
PARAMETER = "/nota/production/signing/turn-secret"
TARGETS = [
    "aws_instance.signing_turn", "aws_route53_record.signing_turn",
    "aws_iam_role_policy.signing_turn_api_secret",
]


def run(argv, *, payload=None, env=None):
    result = subprocess.run(argv, input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, cwd=ROOT, env=env)
    if result.returncode:
        # No payload, request body, secret result, or environment is printed.
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(argv[:4])}; {result.stderr[-1000:]}")
    return result.stdout


def aws(profile, service, operation, **payload):
    argv = ["aws", "--profile", profile, "--region", REGION, service, operation, "--output", "json"]
    if payload:
        # macOS CLI parameter loading may read the input more than once;
        # a private temporary request is reliable where /dev/stdin is not.
        with tempfile.NamedTemporaryFile(mode="w", prefix="nota-turn-request-", suffix=".json") as request:
            os.chmod(request.name, 0o600)
            json.dump(payload, request)
            request.flush()
            argv += ["--cli-input-json", f"file://{request.name}"]
            return json.loads(run(argv) or "{}")
    return json.loads(run(argv) or "{}")


def verify_account(profile):
    account = aws(profile, "sts", "get-caller-identity")["Account"]
    if account != ACCOUNT:
        raise RuntimeError("Wrong AWS account; stopping before any changes")


def prepare_secret(profile):
    response = aws(profile, "ssm", "describe-parameters", ParameterFilters=[
        {"Key": "Name", "Option": "Equals", "Values": [PARAMETER]}
    ])
    existing = response.get("Parameters", [])
    if existing:
        if existing[0]["Type"] != "SecureString":
            raise RuntimeError("TURN parameter exists without SecureString protection")
        print("Existing dedicated TURN SecureString retained; value was not retrieved.")
        return
    aws(profile, "ssm", "put-parameter", Name=PARAMETER, Type="SecureString",
        Value=secrets.token_urlsafe(48), Description="Signing beta coturn REST shared secret; server-side only",
        Tier="Standard", Tags=[{"Key": "Project", "Value": "nota"}, {"Key": "Purpose", "Value": "signing-turn"}])
    print("Created dedicated TURN SecureString; value omitted.")


def changes(plan, env):
    payload = json.loads(run(["terraform", f"-chdir={INFRA}", "show", "-json", str(plan)], env=env))
    out = []
    for item in payload.get("resource_changes", []):
        actions = item["change"]["actions"]
        if actions in (["no-op"], ["read"]):
            continue
        if not item.get("name", "").startswith("signing_turn") or actions != ["create"]:
            raise RuntimeError(f"Plan would change an existing/unrelated resource: {item['address']} {actions}")
        out.append({"address": item["address"], "actions": actions})
    if not out:
        raise RuntimeError("No new TURN resources in plan; use a separately reviewed maintenance workflow")
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["plan", "apply"])
    parser.add_argument("--profile", default="aws-prod")
    parser.add_argument("--plan", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    verify_account(args.profile)
    env = {**os.environ, "AWS_PROFILE": args.profile, "AWS_REGION": REGION}
    if args.action == "plan":
        prepare_secret(args.profile)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        private = Path.home() / ".aws" / "nota-state-backups"
        private.mkdir(mode=0o700, exist_ok=True)
        backup = private / f"terraform-pre-signing-turn-{stamp}.tfstate"
        shutil.copy2(INFRA / "terraform.tfstate", backup)
        backup.chmod(0o600)
        plan = (args.plan or Path(tempfile.mkdtemp(prefix="nota-turn-")) / "turn.tfplan").resolve()
        argv = ["terraform", f"-chdir={INFRA}", "plan", "-input=false", "-var-file=gonata.tfvars",
                "-var=signing_turn_enabled=true", f"-out={plan}"]
        argv += [f"-target={target}" for target in TARGETS]
        output = run(argv, env=env)
        plan.chmod(0o600)
        log = plan.with_suffix(".log")
        log.write_text(output)
        log.chmod(0o600)
        print(json.dumps({"plan": str(plan), "stateBackup": str(backup), "changes": changes(plan, env)}, indent=2))
    else:
        if args.plan is None:
            parser.error("apply requires the exact reviewed --plan path")
        plan = args.plan.resolve()
        print(json.dumps({"applying": changes(plan, env)}, indent=2))
        run(["terraform", f"-chdir={INFRA}", "apply", "-input=false", str(plan)], env=env)
        print(run(["terraform", f"-chdir={INFRA}", "output", "-json", "signing_turn"], env=env))


if __name__ == "__main__":
    main()
