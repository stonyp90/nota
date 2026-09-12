# The signing beta is a rehearsal; legally operative notarial signing stays off.
# Camera/microphone permissions apply only to the dedicated signing document.
variable "signing_beta_enabled" {
  description = "Enable the authenticated signing rehearsal beta. Never enables notarial act closure."
  type        = bool
  default     = false
}

resource "aws_cloudfront_response_headers_policy" "signing" {
  name    = "${var.project_name}-signing-beta-headers"
  comment = "Isolated signing document: same-origin camera/mic, no third-party script, no framing."

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    content_security_policy {
      content_security_policy = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'"
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(self), microphone=(self), fullscreen=(self), display-capture=(), geolocation=()"
      override = true
    }
    items {
      header   = "Cache-Control"
      value    = "no-store"
      override = true
    }
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}
