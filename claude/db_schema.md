| table_name                 | column_name                  | data_type                   | character_maximum_length | is_nullable | column_default                                  |
| -------------------------- | ---------------------------- | --------------------------- | ------------------------ | ----------- | ----------------------------------------------- |
| audit_log_entries          | instance_id                  | uuid                        | null                     | YES         | null                                            |
| audit_log_entries          | id                           | uuid                        | null                     | NO          | null                                            |
| audit_log_entries          | payload                      | json                        | null                     | YES         | null                                            |
| audit_log_entries          | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| audit_log_entries          | ip_address                   | character varying           | 64                       | NO          | ''::character varying                           |
| flow_state                 | id                           | uuid                        | null                     | NO          | null                                            |
| flow_state                 | user_id                      | uuid                        | null                     | YES         | null                                            |
| flow_state                 | auth_code                    | text                        | null                     | NO          | null                                            |
| flow_state                 | code_challenge_method        | USER-DEFINED                | null                     | NO          | null                                            |
| flow_state                 | code_challenge               | text                        | null                     | NO          | null                                            |
| flow_state                 | provider_type                | text                        | null                     | NO          | null                                            |
| flow_state                 | provider_access_token        | text                        | null                     | YES         | null                                            |
| flow_state                 | provider_refresh_token       | text                        | null                     | YES         | null                                            |
| flow_state                 | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| flow_state                 | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| flow_state                 | authentication_method        | text                        | null                     | NO          | null                                            |
| flow_state                 | auth_code_issued_at          | timestamp with time zone    | null                     | YES         | null                                            |
| identities                 | provider_id                  | text                        | null                     | NO          | null                                            |
| identities                 | user_id                      | uuid                        | null                     | NO          | null                                            |
| identities                 | identity_data                | jsonb                       | null                     | NO          | null                                            |
| identities                 | provider                     | text                        | null                     | NO          | null                                            |
| identities                 | last_sign_in_at              | timestamp with time zone    | null                     | YES         | null                                            |
| identities                 | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| identities                 | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| identities                 | email                        | text                        | null                     | YES         | null                                            |
| identities                 | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| instances                  | id                           | uuid                        | null                     | NO          | null                                            |
| instances                  | uuid                         | uuid                        | null                     | YES         | null                                            |
| instances                  | raw_base_config              | text                        | null                     | YES         | null                                            |
| instances                  | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| instances                  | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| mfa_amr_claims             | session_id                   | uuid                        | null                     | NO          | null                                            |
| mfa_amr_claims             | created_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| mfa_amr_claims             | updated_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| mfa_amr_claims             | authentication_method        | text                        | null                     | NO          | null                                            |
| mfa_amr_claims             | id                           | uuid                        | null                     | NO          | null                                            |
| mfa_challenges             | id                           | uuid                        | null                     | NO          | null                                            |
| mfa_challenges             | factor_id                    | uuid                        | null                     | NO          | null                                            |
| mfa_challenges             | created_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| mfa_challenges             | verified_at                  | timestamp with time zone    | null                     | YES         | null                                            |
| mfa_challenges             | ip_address                   | inet                        | null                     | NO          | null                                            |
| mfa_challenges             | otp_code                     | text                        | null                     | YES         | null                                            |
| mfa_challenges             | web_authn_session_data       | jsonb                       | null                     | YES         | null                                            |
| mfa_factors                | id                           | uuid                        | null                     | NO          | null                                            |
| mfa_factors                | user_id                      | uuid                        | null                     | NO          | null                                            |
| mfa_factors                | friendly_name                | text                        | null                     | YES         | null                                            |
| mfa_factors                | factor_type                  | USER-DEFINED                | null                     | NO          | null                                            |
| mfa_factors                | status                       | USER-DEFINED                | null                     | NO          | null                                            |
| mfa_factors                | created_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| mfa_factors                | updated_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| mfa_factors                | secret                       | text                        | null                     | YES         | null                                            |
| mfa_factors                | phone                        | text                        | null                     | YES         | null                                            |
| mfa_factors                | last_challenged_at           | timestamp with time zone    | null                     | YES         | null                                            |
| mfa_factors                | web_authn_credential         | jsonb                       | null                     | YES         | null                                            |
| mfa_factors                | web_authn_aaguid             | uuid                        | null                     | YES         | null                                            |
| mfa_factors                | last_webauthn_challenge_data | jsonb                       | null                     | YES         | null                                            |
| oauth_authorizations       | id                           | uuid                        | null                     | NO          | null                                            |
| oauth_authorizations       | authorization_id             | text                        | null                     | NO          | null                                            |
| oauth_authorizations       | client_id                    | uuid                        | null                     | NO          | null                                            |
| oauth_authorizations       | user_id                      | uuid                        | null                     | YES         | null                                            |
| oauth_authorizations       | redirect_uri                 | text                        | null                     | NO          | null                                            |
| oauth_authorizations       | scope                        | text                        | null                     | NO          | null                                            |
| oauth_authorizations       | state                        | text                        | null                     | YES         | null                                            |
| oauth_authorizations       | resource                     | text                        | null                     | YES         | null                                            |
| oauth_authorizations       | code_challenge               | text                        | null                     | YES         | null                                            |
| oauth_authorizations       | code_challenge_method        | USER-DEFINED                | null                     | YES         | null                                            |
| oauth_authorizations       | response_type                | USER-DEFINED                | null                     | NO          | 'code'::auth.oauth_response_type                |
| oauth_authorizations       | status                       | USER-DEFINED                | null                     | NO          | 'pending'::auth.oauth_authorization_status      |
| oauth_authorizations       | authorization_code           | text                        | null                     | YES         | null                                            |
| oauth_authorizations       | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| oauth_authorizations       | expires_at                   | timestamp with time zone    | null                     | NO          | (now() + '00:03:00'::interval)                  |
| oauth_authorizations       | approved_at                  | timestamp with time zone    | null                     | YES         | null                                            |
| oauth_authorizations       | nonce                        | text                        | null                     | YES         | null                                            |
| oauth_client_states        | id                           | uuid                        | null                     | NO          | null                                            |
| oauth_client_states        | provider_type                | text                        | null                     | NO          | null                                            |
| oauth_client_states        | code_verifier                | text                        | null                     | YES         | null                                            |
| oauth_client_states        | created_at                   | timestamp with time zone    | null                     | NO          | null                                            |
| oauth_clients              | id                           | uuid                        | null                     | NO          | null                                            |
| oauth_clients              | client_secret_hash           | text                        | null                     | YES         | null                                            |
| oauth_clients              | registration_type            | USER-DEFINED                | null                     | NO          | null                                            |
| oauth_clients              | redirect_uris                | text                        | null                     | NO          | null                                            |
| oauth_clients              | grant_types                  | text                        | null                     | NO          | null                                            |
| oauth_clients              | client_name                  | text                        | null                     | YES         | null                                            |
| oauth_clients              | client_uri                   | text                        | null                     | YES         | null                                            |
| oauth_clients              | logo_uri                     | text                        | null                     | YES         | null                                            |
| oauth_clients              | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| oauth_clients              | updated_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| oauth_clients              | deleted_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| oauth_clients              | client_type                  | USER-DEFINED                | null                     | NO          | 'confidential'::auth.oauth_client_type          |
| oauth_consents             | id                           | uuid                        | null                     | NO          | null                                            |
| oauth_consents             | user_id                      | uuid                        | null                     | NO          | null                                            |
| oauth_consents             | client_id                    | uuid                        | null                     | NO          | null                                            |
| oauth_consents             | scopes                       | text                        | null                     | NO          | null                                            |
| oauth_consents             | granted_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| oauth_consents             | revoked_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| one_time_tokens            | id                           | uuid                        | null                     | NO          | null                                            |
| one_time_tokens            | user_id                      | uuid                        | null                     | NO          | null                                            |
| one_time_tokens            | token_type                   | USER-DEFINED                | null                     | NO          | null                                            |
| one_time_tokens            | token_hash                   | text                        | null                     | NO          | null                                            |
| one_time_tokens            | relates_to                   | text                        | null                     | NO          | null                                            |
| one_time_tokens            | created_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| one_time_tokens            | updated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| refresh_tokens             | instance_id                  | uuid                        | null                     | YES         | null                                            |
| refresh_tokens             | id                           | bigint                      | null                     | NO          | nextval('auth.refresh_tokens_id_seq'::regclass) |
| refresh_tokens             | token                        | character varying           | 255                      | YES         | null                                            |
| refresh_tokens             | user_id                      | character varying           | 255                      | YES         | null                                            |
| refresh_tokens             | revoked                      | boolean                     | null                     | YES         | null                                            |
| refresh_tokens             | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| refresh_tokens             | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| refresh_tokens             | parent                       | character varying           | 255                      | YES         | null                                            |
| refresh_tokens             | session_id                   | uuid                        | null                     | YES         | null                                            |
| saml_providers             | id                           | uuid                        | null                     | NO          | null                                            |
| saml_providers             | sso_provider_id              | uuid                        | null                     | NO          | null                                            |
| saml_providers             | entity_id                    | text                        | null                     | NO          | null                                            |
| saml_providers             | metadata_xml                 | text                        | null                     | NO          | null                                            |
| saml_providers             | metadata_url                 | text                        | null                     | YES         | null                                            |
| saml_providers             | attribute_mapping            | jsonb                       | null                     | YES         | null                                            |
| saml_providers             | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| saml_providers             | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| saml_providers             | name_id_format               | text                        | null                     | YES         | null                                            |
| saml_relay_states          | id                           | uuid                        | null                     | NO          | null                                            |
| saml_relay_states          | sso_provider_id              | uuid                        | null                     | NO          | null                                            |
| saml_relay_states          | request_id                   | text                        | null                     | NO          | null                                            |
| saml_relay_states          | for_email                    | text                        | null                     | YES         | null                                            |
| saml_relay_states          | redirect_to                  | text                        | null                     | YES         | null                                            |
| saml_relay_states          | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| saml_relay_states          | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| saml_relay_states          | flow_state_id                | uuid                        | null                     | YES         | null                                            |
| schema_migrations          | version                      | character varying           | 255                      | NO          | null                                            |
| sessions                   | id                           | uuid                        | null                     | NO          | null                                            |
| sessions                   | user_id                      | uuid                        | null                     | NO          | null                                            |
| sessions                   | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sessions                   | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sessions                   | factor_id                    | uuid                        | null                     | YES         | null                                            |
| sessions                   | aal                          | USER-DEFINED                | null                     | YES         | null                                            |
| sessions                   | not_after                    | timestamp with time zone    | null                     | YES         | null                                            |
| sessions                   | refreshed_at                 | timestamp without time zone | null                     | YES         | null                                            |
| sessions                   | user_agent                   | text                        | null                     | YES         | null                                            |
| sessions                   | ip                           | inet                        | null                     | YES         | null                                            |
| sessions                   | tag                          | text                        | null                     | YES         | null                                            |
| sessions                   | oauth_client_id              | uuid                        | null                     | YES         | null                                            |
| sessions                   | refresh_token_hmac_key       | text                        | null                     | YES         | null                                            |
| sessions                   | refresh_token_counter        | bigint                      | null                     | YES         | null                                            |
| sessions                   | scopes                       | text                        | null                     | YES         | null                                            |
| sso_domains                | id                           | uuid                        | null                     | NO          | null                                            |
| sso_domains                | sso_provider_id              | uuid                        | null                     | NO          | null                                            |
| sso_domains                | domain                       | text                        | null                     | NO          | null                                            |
| sso_domains                | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sso_domains                | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sso_providers              | id                           | uuid                        | null                     | NO          | null                                            |
| sso_providers              | resource_id                  | text                        | null                     | YES         | null                                            |
| sso_providers              | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sso_providers              | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| sso_providers              | disabled                     | boolean                     | null                     | YES         | null                                            |
| users                      | instance_id                  | uuid                        | null                     | YES         | null                                            |
| users                      | id                           | uuid                        | null                     | NO          | null                                            |
| users                      | aud                          | character varying           | 255                      | YES         | null                                            |
| users                      | role                         | character varying           | 255                      | YES         | null                                            |
| users                      | email                        | character varying           | 255                      | YES         | null                                            |
| users                      | encrypted_password           | character varying           | 255                      | YES         | null                                            |
| users                      | email_confirmed_at           | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | invited_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | confirmation_token           | character varying           | 255                      | YES         | null                                            |
| users                      | confirmation_sent_at         | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | recovery_token               | character varying           | 255                      | YES         | null                                            |
| users                      | recovery_sent_at             | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | email_change_token_new       | character varying           | 255                      | YES         | null                                            |
| users                      | email_change                 | character varying           | 255                      | YES         | null                                            |
| users                      | email_change_sent_at         | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | last_sign_in_at              | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | raw_app_meta_data            | jsonb                       | null                     | YES         | null                                            |
| users                      | raw_user_meta_data           | jsonb                       | null                     | YES         | null                                            |
| users                      | is_super_admin               | boolean                     | null                     | YES         | null                                            |
| users                      | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | phone                        | text                        | null                     | YES         | NULL::character varying                         |
| users                      | phone_confirmed_at           | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | phone_change                 | text                        | null                     | YES         | ''::character varying                           |
| users                      | phone_change_token           | character varying           | 255                      | YES         | ''::character varying                           |
| users                      | phone_change_sent_at         | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | confirmed_at                 | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | email_change_token_current   | character varying           | 255                      | YES         | ''::character varying                           |
| users                      | email_change_confirm_status  | smallint                    | null                     | YES         | 0                                               |
| users                      | banned_until                 | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | reauthentication_token       | character varying           | 255                      | YES         | ''::character varying                           |
| users                      | reauthentication_sent_at     | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | is_sso_user                  | boolean                     | null                     | NO          | false                                           |
| users                      | deleted_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| users                      | is_anonymous                 | boolean                     | null                     | NO          | false                                           |
| pg_stat_statements         | userid                       | oid                         | null                     | YES         | null                                            |
| pg_stat_statements         | dbid                         | oid                         | null                     | YES         | null                                            |
| pg_stat_statements         | toplevel                     | boolean                     | null                     | YES         | null                                            |
| pg_stat_statements         | queryid                      | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | query                        | text                        | null                     | YES         | null                                            |
| pg_stat_statements         | plans                        | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | total_plan_time              | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | min_plan_time                | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | max_plan_time                | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | mean_plan_time               | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | stddev_plan_time             | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | calls                        | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | total_exec_time              | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | min_exec_time                | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | max_exec_time                | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | mean_exec_time               | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | stddev_exec_time             | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | rows                         | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blks_hit              | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blks_read             | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blks_dirtied          | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blks_written          | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | local_blks_hit               | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | local_blks_read              | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | local_blks_dirtied           | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | local_blks_written           | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | temp_blks_read               | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | temp_blks_written            | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blk_read_time         | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | shared_blk_write_time        | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | local_blk_read_time          | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | local_blk_write_time         | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | temp_blk_read_time           | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | temp_blk_write_time          | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | wal_records                  | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | wal_fpi                      | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | wal_bytes                    | numeric                     | null                     | YES         | null                                            |
| pg_stat_statements         | jit_functions                | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | jit_generation_time          | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | jit_inlining_count           | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | jit_inlining_time            | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | jit_optimization_count       | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | jit_optimization_time        | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | jit_emission_count           | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | jit_emission_time            | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | jit_deform_count             | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements         | jit_deform_time              | double precision            | null                     | YES         | null                                            |
| pg_stat_statements         | stats_since                  | timestamp with time zone    | null                     | YES         | null                                            |
| pg_stat_statements         | minmax_stats_since           | timestamp with time zone    | null                     | YES         | null                                            |
| pg_stat_statements_info    | dealloc                      | bigint                      | null                     | YES         | null                                            |
| pg_stat_statements_info    | stats_reset                  | timestamp with time zone    | null                     | YES         | null                                            |
| cron_job_runs              | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| cron_job_runs              | job_name                     | text                        | null                     | NO          | null                                            |
| cron_job_runs              | status                       | text                        | null                     | NO          | null                                            |
| cron_job_runs              | started_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| cron_job_runs              | completed_at                 | timestamp with time zone    | null                     | YES         | null                                            |
| cron_job_runs              | duration_ms                  | integer                     | null                     | YES         | null                                            |
| cron_job_runs              | result                       | jsonb                       | null                     | YES         | null                                            |
| curated_events             | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| curated_events             | user_id                      | uuid                        | null                     | NO          | null                                            |
| curated_events             | event_id                     | uuid                        | null                     | NO          | null                                            |
| curated_events             | note                         | text                        | null                     | YES         | null                                            |
| curated_events             | curated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| curated_events             | score_boost                  | jsonb                       | null                     | YES         | null                                            |
| curator_profiles           | user_id                      | uuid                        | null                     | NO          | null                                            |
| curator_profiles           | slug                         | text                        | null                     | NO          | null                                            |
| curator_profiles           | display_name                 | text                        | null                     | NO          | null                                            |
| curator_profiles           | bio                          | text                        | null                     | YES         | null                                            |
| curator_profiles           | is_public                    | boolean                     | null                     | NO          | false                                           |
| curator_profiles           | created_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| curator_profiles           | updated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| curator_profiles           | show_profile_picture         | boolean                     | null                     | NO          | false                                           |
| curator_profiles           | avatar_url                   | text                        | null                     | YES         | null                                            |
| curator_profiles           | title                        | text                        | null                     | YES         | null                                            |
| curator_profiles           | is_verified                  | boolean                     | null                     | NO          | false                                           |
| curator_profiles           | verified_at                  | timestamp with time zone    | null                     | YES         | null                                            |
| curator_profiles           | verified_by                  | uuid                        | null                     | YES         | null                                            |
| events                     | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| events                     | source_id                    | text                        | null                     | NO          | null                                            |
| events                     | source                       | text                        | null                     | NO          | null                                            |
| events                     | title                        | text                        | null                     | NO          | null                                            |
| events                     | description                  | text                        | null                     | YES         | null                                            |
| events                     | start_date                   | timestamp with time zone    | null                     | NO          | null                                            |
| events                     | location                     | text                        | null                     | YES         | null                                            |
| events                     | zip                          | text                        | null                     | YES         | null                                            |
| events                     | organizer                    | text                        | null                     | YES         | null                                            |
| events                     | price                        | text                        | null                     | YES         | null                                            |
| events                     | url                          | text                        | null                     | NO          | null                                            |
| events                     | image_url                    | text                        | null                     | YES         | null                                            |
| events                     | created_at                   | timestamp without time zone | null                     | YES         | now()                                           |
| events                     | hidden                       | boolean                     | null                     | YES         | false                                           |
| events                     | tags                         | ARRAY                       | null                     | YES         | null                                            |
| events                     | interested_count             | integer                     | null                     | YES         | null                                            |
| events                     | going_count                  | integer                     | null                     | YES         | null                                            |
| events                     | time_unknown                 | boolean                     | null                     | YES         | false                                           |
| events                     | recurring_type               | text                        | null                     | YES         | null                                            |
| events                     | recurring_end_date           | timestamp with time zone    | null                     | YES         | null                                            |
| events                     | favorite_count               | integer                     | null                     | YES         | 0                                               |
| events                     | ai_summary                   | text                        | null                     | YES         | null                                            |
| events                     | embedding                    | USER-DEFINED                | null                     | YES         | null                                            |
| events                     | updated_at                   | timestamp without time zone | null                     | YES         | now()                                           |
| events                     | last_seen_at                 | timestamp without time zone | null                     | YES         | now()                                           |
| events                     | score                        | integer                     | null                     | YES         | null                                            |
| events                     | score_rarity                 | integer                     | null                     | YES         | null                                            |
| events                     | score_unique                 | integer                     | null                     | YES         | null                                            |
| events                     | score_magnitude              | integer                     | null                     | YES         | null                                            |
| events                     | score_reason                 | text                        | null                     | YES         | null                                            |
| events                     | last_verified_at             | timestamp with time zone    | null                     | YES         | null                                            |
| events                     | score_override               | jsonb                       | null                     | YES         | null                                            |
| events                     | score_asheville_weird        | integer                     | null                     | YES         | null                                            |
| events                     | score_social                 | integer                     | null                     | YES         | null                                            |
| newsletter_settings        | user_id                      | uuid                        | null                     | NO          | null                                            |
| newsletter_settings        | frequency                    | text                        | null                     | NO          | 'none'::text                                    |
| newsletter_settings        | weekend_edition              | boolean                     | null                     | NO          | false                                           |
| newsletter_settings        | score_tier                   | text                        | null                     | NO          | 'all'::text                                     |
| newsletter_settings        | filters                      | jsonb                       | null                     | YES         | null                                            |
| newsletter_settings        | curator_user_ids             | ARRAY                       | null                     | YES         | '{}'::uuid[]                                    |
| newsletter_settings        | last_sent_at                 | timestamp with time zone    | null                     | YES         | null                                            |
| newsletter_settings        | created_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| newsletter_settings        | updated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| newsletter_settings        | day_selection                | text                        | null                     | NO          | 'everyday'::text                                |
| newsletter_settings        | selected_days                | ARRAY                       | null                     | YES         | '{}'::integer[]                                 |
| newsletter_settings        | top30_subscription           | text                        | null                     | NO          | 'none'::text                                    |
| newsletter_settings        | top30_last_notified_at       | timestamp with time zone    | null                     | YES         | null                                            |
| newsletter_settings        | top30_last_event_ids         | ARRAY                       | null                     | YES         | '{}'::text[]                                    |
| submitted_events           | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| submitted_events           | title                        | text                        | null                     | NO          | null                                            |
| submitted_events           | description                  | text                        | null                     | YES         | null                                            |
| submitted_events           | start_date                   | timestamp with time zone    | null                     | NO          | null                                            |
| submitted_events           | end_date                     | timestamp with time zone    | null                     | YES         | null                                            |
| submitted_events           | location                     | text                        | null                     | YES         | null                                            |
| submitted_events           | organizer                    | text                        | null                     | YES         | null                                            |
| submitted_events           | price                        | text                        | null                     | YES         | null                                            |
| submitted_events           | url                          | text                        | null                     | YES         | null                                            |
| submitted_events           | image_url                    | text                        | null                     | YES         | null                                            |
| submitted_events           | submitter_email              | text                        | null                     | YES         | null                                            |
| submitted_events           | submitter_name               | text                        | null                     | YES         | null                                            |
| submitted_events           | notes                        | text                        | null                     | YES         | null                                            |
| submitted_events           | status                       | text                        | null                     | NO          | 'pending'::text                                 |
| submitted_events           | reviewed_at                  | timestamp without time zone | null                     | YES         | null                                            |
| submitted_events           | created_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| submitted_events           | source                       | text                        | null                     | NO          | 'form'::text                                    |
| user_preferences           | user_id                      | uuid                        | null                     | NO          | null                                            |
| user_preferences           | blocked_hosts                | ARRAY                       | null                     | YES         | '{}'::text[]                                    |
| user_preferences           | blocked_keywords             | ARRAY                       | null                     | YES         | '{}'::text[]                                    |
| user_preferences           | hidden_events                | jsonb                       | null                     | YES         | '[]'::jsonb                                     |
| user_preferences           | use_default_filters          | boolean                     | null                     | YES         | true                                            |
| user_preferences           | favorited_event_ids          | ARRAY                       | null                     | YES         | '{}'::text[]                                    |
| user_preferences           | filter_settings              | jsonb                       | null                     | YES         | null                                            |
| user_preferences           | updated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| user_preferences           | email_digest_frequency       | text                        | null                     | YES         | 'none'::text                                    |
| user_preferences           | email_digest_last_sent_at    | timestamp without time zone | null                     | YES         | null                                            |
| user_preferences           | email_digest_tags            | ARRAY                       | null                     | YES         | '{}'::text[]                                    |
| user_preferences           | positive_signals             | jsonb                       | null                     | YES         | '[]'::jsonb                                     |
| user_preferences           | negative_signals             | jsonb                       | null                     | YES         | '[]'::jsonb                                     |
| user_preferences           | positive_centroid            | USER-DEFINED                | null                     | YES         | null                                            |
| user_preferences           | negative_centroid            | USER-DEFINED                | null                     | YES         | null                                            |
| user_preferences           | centroid_updated_at          | timestamp without time zone | null                     | YES         | null                                            |
| messages                   | topic                        | text                        | null                     | NO          | null                                            |
| messages                   | extension                    | text                        | null                     | NO          | null                                            |
| messages                   | payload                      | jsonb                       | null                     | YES         | null                                            |
| messages                   | event                        | text                        | null                     | YES         | null                                            |
| messages                   | private                      | boolean                     | null                     | YES         | false                                           |
| messages                   | updated_at                   | timestamp without time zone | null                     | NO          | now()                                           |
| messages                   | inserted_at                  | timestamp without time zone | null                     | NO          | now()                                           |
| messages                   | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| schema_migrations          | version                      | bigint                      | null                     | NO          | null                                            |
| schema_migrations          | inserted_at                  | timestamp without time zone | null                     | YES         | null                                            |
| subscription               | id                           | bigint                      | null                     | NO          | null                                            |
| subscription               | subscription_id              | uuid                        | null                     | NO          | null                                            |
| subscription               | entity                       | regclass                    | null                     | NO          | null                                            |
| subscription               | filters                      | ARRAY                       | null                     | NO          | '{}'::realtime.user_defined_filter[]            |
| subscription               | claims                       | jsonb                       | null                     | NO          | null                                            |
| subscription               | claims_role                  | regrole                     | null                     | NO          | null                                            |
| subscription               | created_at                   | timestamp without time zone | null                     | NO          | timezone('utc'::text, now())                    |
| buckets                    | id                           | text                        | null                     | NO          | null                                            |
| buckets                    | name                         | text                        | null                     | NO          | null                                            |
| buckets                    | owner                        | uuid                        | null                     | YES         | null                                            |
| buckets                    | created_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| buckets                    | updated_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| buckets                    | public                       | boolean                     | null                     | YES         | false                                           |
| buckets                    | avif_autodetection           | boolean                     | null                     | YES         | false                                           |
| buckets                    | file_size_limit              | bigint                      | null                     | YES         | null                                            |
| buckets                    | allowed_mime_types           | ARRAY                       | null                     | YES         | null                                            |
| buckets                    | owner_id                     | text                        | null                     | YES         | null                                            |
| buckets                    | type                         | USER-DEFINED                | null                     | NO          | 'STANDARD'::storage.buckettype                  |
| buckets_analytics          | name                         | text                        | null                     | NO          | null                                            |
| buckets_analytics          | type                         | USER-DEFINED                | null                     | NO          | 'ANALYTICS'::storage.buckettype                 |
| buckets_analytics          | format                       | text                        | null                     | NO          | 'ICEBERG'::text                                 |
| buckets_analytics          | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| buckets_analytics          | updated_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| buckets_analytics          | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| buckets_analytics          | deleted_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| buckets_vectors            | id                           | text                        | null                     | NO          | null                                            |
| buckets_vectors            | type                         | USER-DEFINED                | null                     | NO          | 'VECTOR'::storage.buckettype                    |
| buckets_vectors            | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| buckets_vectors            | updated_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| migrations                 | id                           | integer                     | null                     | NO          | null                                            |
| migrations                 | name                         | character varying           | 100                      | NO          | null                                            |
| migrations                 | hash                         | character varying           | 40                       | NO          | null                                            |
| migrations                 | executed_at                  | timestamp without time zone | null                     | YES         | CURRENT_TIMESTAMP                               |
| objects                    | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| objects                    | bucket_id                    | text                        | null                     | YES         | null                                            |
| objects                    | name                         | text                        | null                     | YES         | null                                            |
| objects                    | owner                        | uuid                        | null                     | YES         | null                                            |
| objects                    | created_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| objects                    | updated_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| objects                    | last_accessed_at             | timestamp with time zone    | null                     | YES         | now()                                           |
| objects                    | metadata                     | jsonb                       | null                     | YES         | null                                            |
| objects                    | path_tokens                  | ARRAY                       | null                     | YES         | null                                            |
| objects                    | version                      | text                        | null                     | YES         | null                                            |
| objects                    | owner_id                     | text                        | null                     | YES         | null                                            |
| objects                    | user_metadata                | jsonb                       | null                     | YES         | null                                            |
| objects                    | level                        | integer                     | null                     | YES         | null                                            |
| prefixes                   | bucket_id                    | text                        | null                     | NO          | null                                            |
| prefixes                   | name                         | text                        | null                     | NO          | null                                            |
| prefixes                   | level                        | integer                     | null                     | NO          | null                                            |
| prefixes                   | created_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| prefixes                   | updated_at                   | timestamp with time zone    | null                     | YES         | now()                                           |
| s3_multipart_uploads       | id                           | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads       | in_progress_size             | bigint                      | null                     | NO          | 0                                               |
| s3_multipart_uploads       | upload_signature             | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads       | bucket_id                    | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads       | key                          | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads       | version                      | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads       | owner_id                     | text                        | null                     | YES         | null                                            |
| s3_multipart_uploads       | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| s3_multipart_uploads       | user_metadata                | jsonb                       | null                     | YES         | null                                            |
| s3_multipart_uploads_parts | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| s3_multipart_uploads_parts | upload_id                    | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | size                         | bigint                      | null                     | NO          | 0                                               |
| s3_multipart_uploads_parts | part_number                  | integer                     | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | bucket_id                    | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | key                          | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | etag                         | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | owner_id                     | text                        | null                     | YES         | null                                            |
| s3_multipart_uploads_parts | version                      | text                        | null                     | NO          | null                                            |
| s3_multipart_uploads_parts | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| vector_indexes             | id                           | text                        | null                     | NO          | gen_random_uuid()                               |
| vector_indexes             | name                         | text                        | null                     | NO          | null                                            |
| vector_indexes             | bucket_id                    | text                        | null                     | NO          | null                                            |
| vector_indexes             | data_type                    | text                        | null                     | NO          | null                                            |
| vector_indexes             | dimension                    | integer                     | null                     | NO          | null                                            |
| vector_indexes             | distance_metric              | text                        | null                     | NO          | null                                            |
| vector_indexes             | metadata_configuration       | jsonb                       | null                     | YES         | null                                            |
| vector_indexes             | created_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| vector_indexes             | updated_at                   | timestamp with time zone    | null                     | NO          | now()                                           |
| decrypted_secrets          | id                           | uuid                        | null                     | YES         | null                                            |
| decrypted_secrets          | name                         | text                        | null                     | YES         | null                                            |
| decrypted_secrets          | description                  | text                        | null                     | YES         | null                                            |
| decrypted_secrets          | secret                       | text                        | null                     | YES         | null                                            |
| decrypted_secrets          | decrypted_secret             | text                        | null                     | YES         | null                                            |
| decrypted_secrets          | key_id                       | uuid                        | null                     | YES         | null                                            |
| decrypted_secrets          | nonce                        | bytea                       | null                     | YES         | null                                            |
| decrypted_secrets          | created_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| decrypted_secrets          | updated_at                   | timestamp with time zone    | null                     | YES         | null                                            |
| secrets                    | id                           | uuid                        | null                     | NO          | gen_random_uuid()                               |
| secrets                    | name                         | text                        | null                     | YES         | null                                            |
| secrets                    | description                  | text                        | null                     | NO          | ''::text                                        |
| secrets                    | secret                       | text                        | null                     | NO          | null                                            |
| secrets                    | key_id                       | uuid                        | null                     | YES         | null                                            |
| secrets                    | nonce                        | bytea                       | null                     | YES         | vault._crypto_aead_det_noncegen()               |
| secrets                    | created_at                   | timestamp with time zone    | null                     | NO          | CURRENT_TIMESTAMP                               |
| secrets                    | updated_at                   | timestamp with time zone    | null                     | NO          | CURRENT_TIMESTAMP                               |