# Dedicated, opt-in Canadian TURN relay for the authenticated signing beta.
# Shared credentials are provisioned separately in SSM, never in Terraform.
variable "signing_turn_enabled" {
  type        = bool
  default     = false
  description = "Provision the small Canadian TURN beta relay. Does not enable legal signing."
}

variable "signing_turn_hostname" {
  type        = string
  default     = "turn.gonota.ca"
  description = "Dedicated DNS name for the TURN relay and its TLS certificate."
}

variable "signing_turn_zone_id" {
  type        = string
  default     = "Z030833035KR62N8OK4LD"
  description = "Existing gonota.ca Route53 zone; no zone is created or replaced."
}

variable "signing_turn_secret_parameter" {
  type        = string
  default     = "/nota/production/signing/turn-secret"
  description = "Existing SSM SecureString name. Terraform never reads its value."
}

locals {
  signing_turn_name       = "${var.project_name}-signing-turn"
  signing_turn_secret_arn = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.signing_turn_secret_parameter}"
}

data "aws_ami" "signing_turn" {
  count       = var.signing_turn_enabled ? 1 : 0
  most_recent = true
  owners      = ["099720109477"]
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
  filter {
    name   = "architecture"
    values = ["arm64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_vpc" "signing_turn" {
  count                = var.signing_turn_enabled ? 1 : 0
  cidr_block           = "10.98.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.signing_turn_name }
}

resource "aws_subnet" "signing_turn" {
  count             = var.signing_turn_enabled ? 1 : 0
  vpc_id            = aws_vpc.signing_turn[0].id
  cidr_block        = "10.98.0.0/26"
  availability_zone = "ca-central-1a"
  tags              = { Name = local.signing_turn_name }
}

resource "aws_internet_gateway" "signing_turn" {
  count  = var.signing_turn_enabled ? 1 : 0
  vpc_id = aws_vpc.signing_turn[0].id
  tags   = { Name = local.signing_turn_name }
}

resource "aws_route_table" "signing_turn" {
  count  = var.signing_turn_enabled ? 1 : 0
  vpc_id = aws_vpc.signing_turn[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.signing_turn[0].id
  }
  tags = { Name = local.signing_turn_name }
}

resource "aws_route_table_association" "signing_turn" {
  count          = var.signing_turn_enabled ? 1 : 0
  subnet_id      = aws_subnet.signing_turn[0].id
  route_table_id = aws_route_table.signing_turn[0].id
}

resource "aws_security_group" "signing_turn" {
  count       = var.signing_turn_enabled ? 1 : 0
  name        = local.signing_turn_name
  description = "TURN listeners and bounded UDP relay ports; no SSH ingress"
  vpc_id      = aws_vpc.signing_turn[0].id
  ingress {
    description = "Authenticated TURN over UDP"
    protocol    = "udp"
    from_port   = 3478
    to_port     = 3478
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "Authenticated TURN over TCP"
    protocol    = "tcp"
    from_port   = 3478
    to_port     = 3478
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "Authenticated TURN over TLS for restrictive networks"
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "Bounded relay allocation ports"
    protocol    = "udp"
    from_port   = 49160
    to_port     = 49200
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "Public media peers and HTTPS package, SSM, certificate services"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = local.signing_turn_name }
}

resource "aws_network_interface" "signing_turn" {
  count           = var.signing_turn_enabled ? 1 : 0
  subnet_id       = aws_subnet.signing_turn[0].id
  security_groups = [aws_security_group.signing_turn[0].id]
  tags            = { Name = local.signing_turn_name }
}

resource "aws_eip" "signing_turn" {
  count  = var.signing_turn_enabled ? 1 : 0
  domain = "vpc"
  tags   = { Name = local.signing_turn_name }
}

resource "aws_eip_association" "signing_turn" {
  count                = var.signing_turn_enabled ? 1 : 0
  allocation_id        = aws_eip.signing_turn[0].id
  network_interface_id = aws_network_interface.signing_turn[0].id
  depends_on           = [aws_internet_gateway.signing_turn]
}

resource "aws_iam_role" "signing_turn" {
  count = var.signing_turn_enabled ? 1 : 0
  name  = local.signing_turn_name
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}

resource "aws_iam_role_policy" "signing_turn_management" {
  count = var.signing_turn_enabled ? 1 : 0
  name  = "${local.signing_turn_name}-management"
  role  = aws_iam_role.signing_turn[0].id
  # Deliberately omit the broad GetParameters permission in the AWS managed
  # instance-core policy. This host needs only its one TURN secret below.
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ssm:UpdateInstanceInformation"], Resource = "*" },
    { Effect = "Allow", Action = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], Resource = "*" },
    { Effect = "Allow", Action = ["ec2messages:AcknowledgeMessage", "ec2messages:DeleteMessage", "ec2messages:FailMessage", "ec2messages:GetEndpoint", "ec2messages:GetMessages", "ec2messages:SendReply"], Resource = "*" }
  ] })
}

resource "aws_iam_role_policy" "signing_turn" {
  count = var.signing_turn_enabled ? 1 : 0
  name  = local.signing_turn_name
  role  = aws_iam_role.signing_turn[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = local.signing_turn_secret_arn },
    { Effect = "Allow", Action = ["route53:ListHostedZones"], Resource = "*" },
    { Effect = "Allow", Action = ["route53:GetChange"], Resource = "arn:aws:route53:::change/*" },
    { Effect = "Allow", Action = ["route53:ChangeResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/${var.signing_turn_zone_id}", Condition = {
      "ForAllValues:StringEquals" = {
        "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["_acme-challenge.${var.signing_turn_hostname}"]
        "route53:ChangeResourceRecordSetsRecordTypes"           = ["TXT"]
        "route53:ChangeResourceRecordSetsActions"               = ["UPSERT", "DELETE"]
      }
    } }
  ] })
}

resource "aws_iam_instance_profile" "signing_turn" {
  count = var.signing_turn_enabled ? 1 : 0
  name  = local.signing_turn_name
  role  = aws_iam_role.signing_turn[0].name
}

resource "aws_iam_role_policy" "signing_turn_api_secret" {
  count = var.signing_turn_enabled ? 1 : 0
  name  = "${local.signing_turn_name}-secret"
  role  = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["ssm:GetParameter"], Resource = local.signing_turn_secret_arn
  }] })
}

resource "aws_instance" "signing_turn" {
  count                = var.signing_turn_enabled ? 1 : 0
  ami                  = data.aws_ami.signing_turn[0].id
  instance_type        = "t4g.micro"
  iam_instance_profile = aws_iam_instance_profile.signing_turn[0].name
  network_interface {
    network_interface_id = aws_network_interface.signing_turn[0].id
    device_index         = 0
  }
  credit_specification { cpu_credits = "standard" }
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }
  user_data = templatefile("${path.module}/templates/signing-turn-cloud-init.sh.tftpl", {
    hostname         = var.signing_turn_hostname
    region           = var.region
    secret_parameter = var.signing_turn_secret_parameter
    private_ip       = aws_network_interface.signing_turn[0].private_ip
    public_ip        = aws_eip.signing_turn[0].public_ip
  })
  user_data_replace_on_change = true
  tags                        = { Name = local.signing_turn_name, Purpose = "signing-beta-encrypted-media-relay" }
  depends_on = [
    aws_eip_association.signing_turn, aws_route_table_association.signing_turn,
    aws_iam_role_policy.signing_turn, aws_iam_role_policy.signing_turn_management
  ]
  lifecycle {
    precondition {
      condition     = var.region == "ca-central-1"
      error_message = "The signing beta relay must remain in ca-central-1."
    }
  }
}

resource "aws_route53_record" "signing_turn" {
  count   = var.signing_turn_enabled ? 1 : 0
  zone_id = var.signing_turn_zone_id
  name    = var.signing_turn_hostname
  type    = "A"
  ttl     = 300
  records = [aws_eip.signing_turn[0].public_ip]
}

output "signing_turn" {
  value = var.signing_turn_enabled ? {
    instance_id      = aws_instance.signing_turn[0].id
    public_ip        = aws_eip.signing_turn[0].public_ip
    hostname         = var.signing_turn_hostname
    secret_parameter = var.signing_turn_secret_parameter
    urls = [
      "turn:${var.signing_turn_hostname}:3478?transport=udp",
      "turn:${var.signing_turn_hostname}:3478?transport=tcp",
      "turns:${var.signing_turn_hostname}:443?transport=tcp"
    ]
    daily_egress_limit_bytes = 5368709120
  } : null
}
