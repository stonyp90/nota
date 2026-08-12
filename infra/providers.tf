###############################################################################
# Terraform + provider configuration
#
# Two AWS providers are declared:
#   - default            -> var.region (ca-central-1) for ALL regional resources
#                           (S3, DynamoDB, Lambda, CloudFront config, Route53).
#   - aws.us_east_1      -> us-east-1, used ONLY for the ACM certificate.
#
# Why the second provider exists:
#   CloudFront can only attach ACM certificates that live in us-east-1. This is
#   a hard AWS constraint regardless of where the rest of the stack runs. So the
#   cert (and nothing else) is created through the aliased us_east_1 provider.
###############################################################################

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Default provider: everything regional lives in ca-central-1 (data residency).
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

# Aliased provider: us-east-1, exclusively for the CloudFront ACM certificate.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
