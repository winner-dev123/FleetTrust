# Copy these into the GitHub variables listed in docs/operations/environments.md.
output "release_variables" {
  description = "Non-secret values the release workflows need."
  value = {
    project_id                 = module.fleettrust.project_id
    region                     = module.fleettrust.region
    registry                   = module.fleettrust.registry
    workload_identity_provider = module.fleettrust.workload_identity_provider
    deploy_service_account     = module.fleettrust.deploy_service_account
    runtime_service_account    = module.fleettrust.runtime_service_account
    cloudsql_connection_name   = module.fleettrust.cloudsql_connection_name
    redis_secret               = module.fleettrust.redis_secret
    vpc_network                = module.fleettrust.vpc_network
    vpc_subnet                 = module.fleettrust.vpc_subnet
    quarantine_bucket          = module.fleettrust.quarantine_bucket
    sensitive_bucket           = module.fleettrust.sensitive_bucket
    public_media_bucket        = module.fleettrust.public_media_bucket
    document_kms_key           = module.fleettrust.document_kms_key
    clamav_host                = module.fleettrust.clamav_host
    scanner_service_account    = module.fleettrust.scanner_service_account
  }
}

output "api_ip_address" {
  description = "A record for the API domain (empty until api_domain is set)."
  value       = module.fleettrust.api_ip_address
}
