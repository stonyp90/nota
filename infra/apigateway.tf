###############################################################################
# API Gateway (HTTP API v2) — public HTTPS front for the Nota Lambda.
#
# Why this exists instead of the Lambda function URL:
#   The function URL is AuthType AWS_IAM and requires lambda:InvokeFunctionUrl,
#   which the account SCP blocks (AuthType NONE is blocked too). An HTTP API
#   invokes the SAME function with lambda:InvokeFunction — a different action
#   the SCP allows. CloudFront's /api/* behavior points at this API's public
#   execute-api endpoint and proxies requests through (no SigV4 signing needed).
#
# Payload format 2.0 delivers exactly the event shape the handler already reads
# (requestContext.http.method, rawPath, queryStringParameters, headers, body),
# so no handler change is required. A $default catch-all route forwards every
# path — including /api/health — straight to the Lambda, which strips the /api
# prefix itself.
###############################################################################

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-http-api"
  protocol_type = "HTTP"
  description   = "Public HTTP API fronting the ${var.project_name}-api Lambda (reached via CloudFront /api/*)."
}

# AWS_PROXY integration to the Lambda, using payload format 2.0.
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# Catch-all route: every method + path is forwarded to the integration.
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

# Auto-deploying default stage: served at the API root with no stage prefix in
# the path, so CloudFront can pass /api/* through unchanged.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# Allow API Gateway to invoke the function with lambda:InvokeFunction (the
# action the SCP permits). Scoped to this API's execution ARN.
resource "aws_lambda_permission" "apigateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

output "api_gateway_endpoint" {
  description = "Public HTTPS endpoint host of the HTTP API (CloudFront /api/* origin)."
  value       = "${aws_apigatewayv2_api.api.id}.execute-api.${var.region}.amazonaws.com"
}
