# Tables

> **Generated file — do not edit by hand.** Regenerate with `npm run docs:gen:data`. One section per table; columns in declaration order.

**80 tables.**

## `active_sessions`

Stores active sessions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL | — |
| `session_id` | INTEGER | — | — |
| `token_hash` | TEXT | UNIQUE | — |
| `login_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `last_activity_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `expires_at` | DATETIME | — | — |
| `ip_address` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `active_treatments`

Stores active treatments records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `treatment_order_id` | INTEGER | NOT NULL | — |
| `effect_id` | INTEGER | — | — |
| `started_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `phase` | TEXT | CHECK(phase IN ('onset', 'peak', 'decline', 'expired')) DEFAULT 'onset' | — |
| `current_effect_strength` | REAL | DEFAULT 0 | — |
| `dose_multiplier` | REAL | DEFAULT 1.0 | — |
| `peak_hr_effect` | INTEGER | DEFAULT 0 | — |
| `peak_bp_sys_effect` | INTEGER | DEFAULT 0 | — |
| `peak_bp_dia_effect` | INTEGER | DEFAULT 0 | — |
| `peak_rr_effect` | INTEGER | DEFAULT 0 | — |
| `peak_spo2_effect` | INTEGER | DEFAULT 0 | — |
| `peak_temp_effect` | REAL | DEFAULT 0 | — |
| `peak_etco2_effect` | INTEGER | DEFAULT 0 | — |
| `expires_at` | DATETIME | — | — |
| `is_continuous` | BOOLEAN | DEFAULT 0 | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `agent_conversations`

Stores agent conversations records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `agent_type` | TEXT | NOT NULL | — |
| `role` | TEXT | NOT NULL | — |
| `content` | TEXT | NOT NULL | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `agent_session_state`

Stores agent session state records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `agent_type` | TEXT | NOT NULL | — |
| `status` | TEXT | DEFAULT 'absent' | — |
| `paged_at` | DATETIME | — | — |
| `arrived_at` | DATETIME | — | — |
| `departed_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |
| `arrives_at` | DATETIME | — | `0024_agent_arrives_at.sql` |

## `agent_templates`

Stores agent templates records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `agent_type` | TEXT | NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `role_title` | TEXT | — | — |
| `avatar_url` | TEXT | — | — |
| `system_prompt` | TEXT | NOT NULL | — |
| `context_filter` | TEXT | DEFAULT 'full' | — |
| `communication_style` | TEXT | — | — |
| `is_default` | BOOLEAN | DEFAULT 0 | — |
| `config` | JSON | — | — |
| `llm_model` | TEXT | — | — |
| `llm_api_key` | TEXT | — | — |
| `llm_endpoint` | TEXT | — | — |
| `llm_config` | JSON | — | — |
| `created_by` | INTEGER | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `llm_temperature` | REAL | — | — |
| `llm_max_tokens` | INTEGER | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |
| `deleted_at` | DATETIME | — | `0005_retention.sql` |

## `alarm_config`

Stores alarm config records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | — | — |
| `vital_sign` | TEXT | — | — |
| `high_threshold` | REAL | — | — |
| `low_threshold` | REAL | — | — |
| `enabled` | BOOLEAN | DEFAULT 1 | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `alarm_events`

Stores alarm events records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `vital_sign` | TEXT | — | — |
| `threshold_type` | TEXT | — | — |
| `threshold_value` | REAL | — | — |
| `actual_value` | REAL | — | — |
| `triggered_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `acknowledged_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `body_map_coordinates`

Stores body map coordinates records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `region_id` | INTEGER | NOT NULL | — |
| `gender` | TEXT | CHECK(gender IN ('male', 'female', 'unisex')) DEFAULT 'unisex' | — |
| `view` | TEXT | CHECK(view IN ('anterior', 'posterior')) NOT NULL | — |
| `polygon_points` | JSON | NOT NULL | — |
| `color_code` | TEXT | — | — |
| `hover_color` | TEXT | — | — |
| `selected_color` | TEXT | — | — |
| `is_clickable` | BOOLEAN | DEFAULT 1 | — |
| `z_index` | INTEGER | DEFAULT 0 | — |

## `body_regions`

Stores body regions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `region_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `anatomical_view` | TEXT | CHECK(anatomical_view IN ('anterior', 'posterior', 'both', 'special')) DEFAULT 'both' | — |
| `description` | TEXT | — | — |
| `parent_region_id` | INTEGER | — | — |
| `display_order` | INTEGER | DEFAULT 0 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `case_agents`

Stores case agents records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | NOT NULL | — |
| `agent_template_id` | INTEGER | NOT NULL | — |
| `enabled` | BOOLEAN | DEFAULT 1 | — |
| `name_override` | TEXT | — | — |
| `system_prompt_override` | TEXT | — | — |
| `availability_type` | TEXT | DEFAULT 'present' | — |
| `available_from_minute` | INTEGER | DEFAULT 0 | — |
| `auto_arrive_minute` | INTEGER | — | — |
| `depart_at_minute` | INTEGER | — | — |
| `response_time_min` | INTEGER | DEFAULT 0 | — |
| `response_time_max` | INTEGER | DEFAULT 0 | — |
| `config_override` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `case_investigations`

Stores case investigations records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | — | — |
| `investigation_type` | TEXT | — | — |
| `test_name` | TEXT | — | — |
| `result_data` | JSON | — | — |
| `image_url` | TEXT | — | — |
| `turnaround_minutes` | INTEGER | DEFAULT 30 | — |
| `test_group` | TEXT | — | — |
| `gender_category` | TEXT | — | — |
| `unit` | TEXT | — | — |
| `normal_samples` | JSON | — | — |
| `is_abnormal` | BOOLEAN | DEFAULT 0 | — |
| `current_value` | REAL | — | — |
| `min_value` | REAL | — | — |
| `max_value` | REAL | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |
| `deleted_at` | DATETIME | — | `0005_retention.sql` |

## `case_treatments`

Stores case treatments records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | NOT NULL | — |
| `treatment_type` | TEXT | NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')) | — |
| `medication_id` | INTEGER | — | — |
| `treatment_name` | TEXT | NOT NULL | — |
| `is_available` | BOOLEAN | DEFAULT 1 | — |
| `is_expected` | BOOLEAN | DEFAULT 0 | — |
| `is_contraindicated` | BOOLEAN | DEFAULT 0 | — |
| `points_if_ordered` | INTEGER | DEFAULT 0 | — |
| `feedback_if_ordered` | TEXT | — | — |
| `feedback_if_missed` | TEXT | — | — |
| `custom_effect_override` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `case_versions`

Stores case versions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `snapshot (config_snapshot)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | NOT NULL | — |
| `version_number` | INTEGER | NOT NULL | — |
| `changed_by` | INTEGER | NOT NULL | — |
| `change_timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `change_type` | TEXT | CHECK(change_type IN ('created', 'updated', 'restored', 'published', 'unpublished')) | — |
| `changes_description` | TEXT | — | — |
| `config_snapshot` | JSON | NOT NULL | — |
| `previous_version_id` | INTEGER | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `cases`

Stores cases records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `system_prompt` | TEXT | — | — |
| `config` | JSON | — | — |
| `patient_name` | TEXT | — | — |
| `patient_gender` | TEXT | CHECK(patient_gender IN ('Male', 'Female', 'Other')) | — |
| `patient_age` | INTEGER | — | — |
| `chief_complaint` | TEXT | — | — |
| `difficulty_level` | TEXT | CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')) | — |
| `estimated_duration_minutes` | INTEGER | — | — |
| `learning_objectives` | JSON | — | — |
| `version` | INTEGER | DEFAULT 1 | — |
| `is_available` | BOOLEAN | DEFAULT 0 | — |
| `is_default` | BOOLEAN | DEFAULT 0 | — |
| `is_published` | BOOLEAN | DEFAULT 0 | — |
| `published_at` | DATETIME | — | — |
| `scenario` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `created_by` | INTEGER | — | — |
| `last_modified_by` | INTEGER | — | — |
| `deleted_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `client_logs`

Stores client logs records.

**Introduced by:** migration `0009_client_logs.sql`

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `tenant_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | — | — |
| `session_id` | INTEGER | — | — |
| `request_id` | TEXT | — | — |
| `level` | TEXT | NOT NULL CHECK(level IN ('debug','info','warn','error')) | — |
| `component` | TEXT | NOT NULL | — |
| `msg` | TEXT | NOT NULL | — |
| `fields_json` | TEXT | — | — |
| `ts` | DATETIME | NOT NULL | — |
| `received_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `clinical_notes`

Stores clinical notes records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | NOT NULL | — |
| `note_type` | TEXT | CHECK(note_type IN ('subjective', 'objective', 'assessment', 'plan', 'general')) DEFAULT 'general' | — |
| `content` | TEXT | NOT NULL | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `clinical_pathways`

Stores clinical pathways records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `pathway_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `condition_id` | INTEGER | — | — |
| `steps` | JSON | NOT NULL | — |
| `duration_hours` | INTEGER | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `cohort_cases`

Stores cohort cases records.

**Introduced by:** migration `0027_cohort_entity.sql`

**Cross-cutting:** `soft-delete` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `cohort_id` | INTEGER | NOT NULL REFERENCES cohorts(id) | — |
| `case_id` | INTEGER | NOT NULL REFERENCES cases(id) | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `available_from` | DATETIME | — | `0030_cohort_case_windows.sql` |
| `available_until` | DATETIME | — | `0030_cohort_case_windows.sql` |

## `cohort_members`

Stores cohort members records.

**Introduced by:** migration `0025_cohorts.sql`

**Cross-cutting:** `soft-delete`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `cohort_id` | INTEGER | NOT NULL REFERENCES cohorts(id) | — |
| `user_id` | INTEGER | NOT NULL REFERENCES users(id) | — |
| `joined_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `member_role` | TEXT | NOT NULL DEFAULT 'student' | `0027_cohort_entity.sql` |
| `status` | TEXT | NOT NULL DEFAULT 'active' | `0030_cohort_case_windows.sql` |
| `enrolled_from` | DATETIME | — | `0030_cohort_case_windows.sql` |
| `enrolled_until` | DATETIME | — | `0030_cohort_case_windows.sql` |

## `cohorts`

Stores cohorts records.

**Introduced by:** migration `0025_cohorts.sql`

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `name` | TEXT | NOT NULL | — |
| `owner_user_id` | INTEGER | NOT NULL REFERENCES users(id) | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | — |
| `join_code` | TEXT | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `description` | TEXT | — | `0027_cohort_entity.sql` |
| `starts_at` | DATETIME | — | `0027_cohort_entity.sql` |
| `ends_at` | DATETIME | — | `0027_cohort_entity.sql` |
| `settings` | JSON | — | `0027_cohort_entity.sql` |

## `custom_drug_group_items`

Stores custom drug group items records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `group_id` | INTEGER | NOT NULL REFERENCES custom_drug_groups(id) ON DELETE CASCADE | — |
| `medication_id` | INTEGER | NOT NULL REFERENCES medications(id) ON DELETE CASCADE | — |
| `position` | INTEGER | NOT NULL DEFAULT 0 | — |

## `custom_drug_groups`

Stores custom drug groups records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `scope` | TEXT | NOT NULL DEFAULT 'platform' | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | — |
| `created_by` | INTEGER | REFERENCES users(id) | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |

## `custom_lab_group_items`

Stores custom lab group items records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `group_id` | INTEGER | NOT NULL REFERENCES custom_lab_groups(id) ON DELETE CASCADE | — |
| `lab_test_id` | INTEGER | NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE | — |
| `position` | INTEGER | NOT NULL DEFAULT 0 | — |

## `custom_lab_groups`

Stores custom lab groups records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `scope` | TEXT | NOT NULL DEFAULT 'platform' | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | — |
| `created_by` | INTEGER | REFERENCES users(id) | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |

## `data_sources`

Stores data sources records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `source_key` | TEXT | UNIQUE NOT NULL | — |
| `source_url` | TEXT | NOT NULL | — |
| `release_version` | TEXT | NOT NULL | — |
| `license` | TEXT | NOT NULL | — |
| `rows_imported` | INTEGER | NOT NULL DEFAULT 0 | — |
| `checksum_sha256` | TEXT | — | — |
| `imported_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `imported_by` | INTEGER | REFERENCES users(id) | — |
| `notes` | TEXT | — | — |

## `diagnoses`

Stores diagnoses records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `icd_code` | TEXT | — | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `category` | TEXT | — | — |
| `body_system` | TEXT | — | — |
| `severity` | TEXT | CHECK(severity IN ('mild', 'moderate', 'severe', 'critical')) | — |
| `typical_findings` | JSON | — | — |
| `differential_diagnoses` | JSON | — | — |
| `workup_recommendations` | JSON | — | — |
| `treatment_guidelines` | JSON | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `emotion_logs`

Stores emotion logs records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `user_id` | INTEGER | — | — |
| `case_id` | INTEGER | — | — |
| `emotion` | TEXT | NOT NULL | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `event_log`

Stores event log records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `event_type` | TEXT | — | — |
| `description` | TEXT | — | — |
| `vital_sign` | TEXT | — | — |
| `old_value` | TEXT | — | — |
| `new_value` | TEXT | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `user_id` | INTEGER | REFERENCES users(id) | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `exam_techniques`

Stores exam techniques records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `technique_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `icon` | TEXT | — | — |
| `description` | TEXT | — | — |
| `display_order` | INTEGER | DEFAULT 0 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `export_records`

Stores export records records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL | — |
| `export_type` | TEXT | NOT NULL | — |
| `export_format` | TEXT | — | — |
| `resource_type` | TEXT | — | — |
| `resource_ids` | JSON | — | — |
| `record_count` | INTEGER | — | — |
| `file_name` | TEXT | — | — |
| `file_size_bytes` | INTEGER | — | — |
| `file_hash` | TEXT | — | — |
| `exported_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `filters_applied` | JSON | — | — |
| `notes` | TEXT | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `interactions`

Stores interactions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `role` | TEXT | CHECK(role IN ('user', 'assistant', 'system')) | — |
| `content` | TEXT | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `investigation_orders`

Stores investigation orders records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `investigation_id` | INTEGER | — | — |
| `ordered_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `available_at` | DATETIME | — | — |
| `viewed_at` | DATETIME | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `investigation_parameters`

Stores investigation parameters records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `investigation_id` | INTEGER | NOT NULL | — |
| `parameter_name` | TEXT | NOT NULL | — |
| `unit` | TEXT | — | — |
| `normal_range_min` | REAL | — | — |
| `normal_range_max` | REAL | — | — |
| `critical_low` | REAL | — | — |
| `critical_high` | REAL | — | — |
| `display_order` | INTEGER | DEFAULT 0 | — |

## `investigation_templates`

Stores investigation templates records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `template_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `category` | TEXT | NOT NULL | — |
| `investigation_type` | TEXT | CHECK(investigation_type IN ('lab', 'radiology', 'procedure', 'other')) NOT NULL | — |
| `turnaround_minutes` | INTEGER | DEFAULT 30 | — |
| `description` | TEXT | — | — |
| `preparation_instructions` | TEXT | — | — |
| `contraindications` | TEXT | — | — |
| `cost` | REAL | — | — |
| `is_stat_available` | BOOLEAN | DEFAULT 1 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `investigation_views`

Stores investigation views records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `investigation_id` | INTEGER | NOT NULL | — |
| `view_name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `display_order` | INTEGER | DEFAULT 0 | — |

## `lab_definitions`

Stores lab definitions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `test_name` | TEXT | NOT NULL | — |
| `test_group` | TEXT | NOT NULL | — |
| `category` | TEXT | CHECK(category IN ('Male', 'Female', 'Both')) DEFAULT 'Both' | — |
| `min_value` | REAL | NOT NULL | — |
| `max_value` | REAL | NOT NULL | — |
| `unit` | TEXT | NOT NULL | — |
| `normal_samples` | JSON | — | — |
| `description` | TEXT | — | — |
| `clinical_significance` | TEXT | — | — |
| `turnaround_minutes` | INTEGER | DEFAULT 30 | — |
| `cost` | REAL | — | — |
| `version` | INTEGER | DEFAULT 1 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `created_by` | INTEGER | — | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | `0005_retention.sql` |

## `lab_panels`

Stores lab panels records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `panel_id` | TEXT | UNIQUE NOT NULL | — |
| `panel_name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `category` | TEXT | — | — |
| `clinical_indication` | TEXT | — | — |
| `is_stat_available` | BOOLEAN | DEFAULT 1 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `display_order` | INTEGER | DEFAULT 0 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `lab_reference_ranges`

Stores lab reference ranges records.

**Introduced by:** migration `0007_drug_lab_catalogue.sql`

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `lab_test_id` | INTEGER | NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE | — |
| `population` | TEXT | NOT NULL CHECK(population IN ('adult', 'pediatric', 'neonatal', 'pregnancy', 'geriatric')) | — |
| `sex` | TEXT | CHECK(sex IN ('M', 'F', 'all') OR sex IS NULL) | — |
| `age_min_years` | REAL | — | — |
| `age_max_years` | REAL | — | — |
| `range_low` | REAL | — | — |
| `range_high` | REAL | — | — |
| `critical_low` | REAL | — | — |
| `critical_high` | REAL | — | — |
| `unit` | TEXT | NOT NULL | — |
| `source` | TEXT | NOT NULL | — |
| `source_citation` | TEXT | — | — |
| `data_source_id` | INTEGER | REFERENCES data_sources(id) | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |

## `lab_tests`

Stores lab tests records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `test_code` | TEXT | UNIQUE | — |
| `test_name` | TEXT | NOT NULL | — |
| `test_group` | TEXT | NOT NULL | — |
| `category` | TEXT | CHECK(category IN ('General', 'Male', 'Female')) DEFAULT 'General' | — |
| `specimen_type` | TEXT | — | — |
| `min_value` | REAL | — | — |
| `max_value` | REAL | — | — |
| `unit` | TEXT | NOT NULL | — |
| `critical_low` | REAL | — | — |
| `critical_high` | REAL | — | — |
| `normal_samples` | JSON | — | — |
| `description` | TEXT | — | — |
| `clinical_significance` | TEXT | — | — |
| `turnaround_minutes` | INTEGER | DEFAULT 30 | — |
| `cost` | REAL | — | — |
| `is_stat_available` | BOOLEAN | DEFAULT 1 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `is_curated` | INTEGER | NOT NULL DEFAULT 0 | `0007_drug_lab_catalogue.sql` |
| `data_source_id` | INTEGER | REFERENCES data_sources(id) | `0007_drug_lab_catalogue.sql` |
| `scope` | TEXT | NOT NULL DEFAULT 'platform' | `0007_drug_lab_catalogue.sql` |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0007_drug_lab_catalogue.sql` |
| `external_source` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `loinc_code` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `ucum_unit` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `created_by` | INTEGER | REFERENCES users(id) | `0007_drug_lab_catalogue.sql` |

## `learning_events`

Stores learning events records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `user_id` | INTEGER | — | — |
| `case_id` | INTEGER | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `object_id` | TEXT | — | — |
| `object_name` | TEXT | — | — |
| `parent_component` | TEXT | — | — |
| `duration_ms` | INTEGER | — | — |
| `message_role` | TEXT | — | — |
| `category` | TEXT | CHECK(category IN ('SESSION', 'NAVIGATION', 'CLINICAL', 'COMMUNICATION', 'MONITORING', 'CONFIGURATION', 'ASSESSMENT', 'ERROR')) | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |
| `vital_hr` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_spo2` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_bp_sys` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_bp_dia` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_rr` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_temp` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_etco2` | REAL | — | `0018_learning_events_vitals.sql` |
| `vital_rhythm` | TEXT | — | `0018_learning_events_vitals.sql` |
| `room` | TEXT | — | `0021_learning_events_room.sql` |

## `llm_model_pricing`

Stores llm model pricing records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `provider` | TEXT | NOT NULL | — |
| `model` | TEXT | NOT NULL | — |
| `input_cost_per_1k` | REAL | NOT NULL | — |
| `output_cost_per_1k` | REAL | NOT NULL | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `llm_request_log`

Stores llm request log records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL | — |
| `session_id` | INTEGER | — | — |
| `model` | TEXT | — | — |
| `prompt_tokens` | INTEGER | — | — |
| `completion_tokens` | INTEGER | — | — |
| `total_tokens` | INTEGER | — | — |
| `estimated_cost` | REAL | — | — |
| `status` | TEXT | CHECK(status IN ('success', 'error', 'rate_limited')) DEFAULT 'success' | — |
| `error_message` | TEXT | — | — |
| `request_timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `response_time_ms` | INTEGER | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `llm_usage`

Stores llm usage records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL | — |
| `date` | DATE | NOT NULL | — |
| `prompt_tokens` | INTEGER | DEFAULT 0 | — |
| `completion_tokens` | INTEGER | DEFAULT 0 | — |
| `total_tokens` | INTEGER | DEFAULT 0 | — |
| `estimated_cost` | REAL | DEFAULT 0 | — |
| `model` | TEXT | — | — |
| `request_count` | INTEGER | DEFAULT 0 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `login_logs`

Stores login logs records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | — | — |
| `username` | TEXT | — | — |
| `action` | TEXT | CHECK(action IN ('login', 'logout', 'failed_login')) NOT NULL | — |
| `ip_address` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `medication_doses`

Stores medication doses records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `medication_id` | INTEGER | NOT NULL | — |
| `dose_description` | TEXT | NOT NULL | — |
| `dose_value` | REAL | — | — |
| `dose_unit` | TEXT | — | — |
| `route` | TEXT | — | — |
| `frequency` | TEXT | — | — |
| `indication` | TEXT | — | — |
| `is_default` | BOOLEAN | DEFAULT 0 | — |
| `display_order` | INTEGER | DEFAULT 0 | — |

## `medications`

Stores medications records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `medication_code` | TEXT | UNIQUE | — |
| `generic_name` | TEXT | NOT NULL | — |
| `brand_names` | JSON | — | — |
| `drug_class` | TEXT | — | — |
| `category` | TEXT | — | — |
| `route` | TEXT | CHECK(route IN ('oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'sublingual', 'rectal', 'other')) | — |
| `typical_dose` | TEXT | — | — |
| `dose_unit` | TEXT | — | — |
| `frequency` | TEXT | — | — |
| `max_daily_dose` | TEXT | — | — |
| `onset_minutes` | INTEGER | — | — |
| `duration_minutes` | INTEGER | — | — |
| `half_life_hours` | REAL | — | — |
| `indications` | JSON | — | — |
| `contraindications` | JSON | — | — |
| `side_effects` | JSON | — | — |
| `interactions` | JSON | — | — |
| `monitoring_parameters` | JSON | — | — |
| `pregnancy_category` | TEXT | — | — |
| `is_controlled` | BOOLEAN | DEFAULT 0 | — |
| `is_high_alert` | BOOLEAN | DEFAULT 0 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | `0005_retention.sql` |
| `is_curated` | INTEGER | NOT NULL DEFAULT 0 | `0007_drug_lab_catalogue.sql` |
| `data_source_id` | INTEGER | REFERENCES data_sources(id) | `0007_drug_lab_catalogue.sql` |
| `scope` | TEXT | NOT NULL DEFAULT 'platform' | `0007_drug_lab_catalogue.sql` |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0007_drug_lab_catalogue.sql` |
| `external_source` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `external_id` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `rxcui` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `ndc_primary` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `atc_code` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `openfda_setid` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `boxed_warning` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `created_by` | INTEGER | REFERENCES users(id) | `0007_drug_lab_catalogue.sql` |

## `oyon_emotion_consents`

Stores oyon emotion consents records.

**Introduced by:** migration `0011_oyon_addon.sql`

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `tenant_id` | TEXT | NOT NULL | — |
| `user_id` | TEXT | NOT NULL | — |
| `student_id` | TEXT | — | — |
| `session_id` | TEXT | — | — |
| `case_id` | TEXT | — | — |
| `consent_granted` | INTEGER | NOT NULL | — |
| `consent_version` | TEXT | NOT NULL | — |
| `source_page` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |

## `oyon_emotion_records`

Stores oyon emotion records records.

**Introduced by:** migration `0011_oyon_addon.sql`

**Cross-cutting:** `tenant-scoped` · `audit (created_at)` · `snapshot (student_name_snapshot, student_role_snapshot, case_title_snapshot, case_category_snapshot, course_title_snapshot, cohort_title_snapshot)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `tenant_id` | TEXT | NOT NULL | — |
| `user_id` | TEXT | NOT NULL | — |
| `student_id` | TEXT | — | — |
| `session_id` | TEXT | NOT NULL | — |
| `case_id` | TEXT | — | — |
| `record_id` | TEXT | — | — |
| `course_id` | TEXT | — | — |
| `cohort_id` | TEXT | — | — |
| `student_name_snapshot` | TEXT | — | — |
| `student_role_snapshot` | TEXT | — | — |
| `case_title_snapshot` | TEXT | — | — |
| `case_category_snapshot` | TEXT | — | — |
| `course_title_snapshot` | TEXT | — | — |
| `cohort_title_snapshot` | TEXT | — | — |
| `session_type` | TEXT | — | — |
| `attempt_number` | INTEGER | — | — |
| `started_from_page` | TEXT | — | — |
| `window_start` | DATETIME | NOT NULL | — |
| `window_end` | DATETIME | NOT NULL | — |
| `dominant_emotion` | TEXT | — | — |
| `emotion_probabilities_json` | TEXT | — | — |
| `valence` | REAL | — | — |
| `arousal` | REAL | — | — |
| `confidence` | REAL | — | — |
| `entropy` | REAL | — | — |
| `valid_frames` | INTEGER | NOT NULL DEFAULT 0 | — |
| `missing_face_ratio` | REAL | NOT NULL DEFAULT 0 | — |
| `quality_json` | TEXT | — | — |
| `model_name` | TEXT | — | — |
| `model_version` | TEXT | — | — |
| `capture_mode` | TEXT | NOT NULL CHECK (capture_mode IN ('local-browser')) | — |
| `capture_status` | TEXT | NOT NULL DEFAULT 'captured' | — |
| `student_consent_enabled` | INTEGER | NOT NULL DEFAULT 0 | — |
| `student_can_view` | INTEGER | NOT NULL DEFAULT 0 | — |
| `admin_can_view` | INTEGER | NOT NULL DEFAULT 1 | — |
| `educator_can_view` | INTEGER | NOT NULL DEFAULT 0 | — |
| `consent_version` | TEXT | NOT NULL | — |
| `consent_recorded_at` | DATETIME | — | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `duration_ms` | INTEGER | — | `0017_oyon_records_window_metadata.sql` |
| `expected_samples` | INTEGER | — | `0017_oyon_records_window_metadata.sql` |
| `valence_std` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `valence_min` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `valence_max` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `arousal_std` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `arousal_min` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `arousal_max` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `confidence_std` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `entropy_std` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `stability_score` | REAL | — | `0017_oyon_records_window_metadata.sql` |
| `label_switch_count` | INTEGER | — | `0017_oyon_records_window_metadata.sql` |
| `model_profile` | TEXT | — | `0017_oyon_records_window_metadata.sql` |
| `settings_hash` | TEXT | — | `0017_oyon_records_window_metadata.sql` |
| `settings_snapshot_json` | TEXT | — | `0017_oyon_records_window_metadata.sql` |
| `dynamics_json` | TEXT | — | `0017_oyon_records_window_metadata.sql` |
| `gaze_json` | TEXT | — | `0028_oyon_records_gaze_engagement.sql` |
| `engagement_json` | TEXT | — | `0028_oyon_records_gaze_engagement.sql` |
| `room` | TEXT | — | `0029_oyon_records_room.sql` |

## `oyon_settings`

Stores oyon settings records.

**Introduced by:** migration `0011_oyon_addon.sql`

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `tenant_id` | TEXT | NOT NULL | — |
| `emotion_capture_enabled` | INTEGER | NOT NULL DEFAULT 1 | — |
| `admin_emotion_view_enabled` | INTEGER | NOT NULL DEFAULT 1 | — |
| `educator_emotion_view_enabled` | INTEGER | NOT NULL DEFAULT 1 | — |
| `student_emotion_view_enabled` | INTEGER | NOT NULL DEFAULT 1 | — |
| `retention_days` | INTEGER | — | — |
| `consent_version` | TEXT | NOT NULL DEFAULT 'oyon-consent-v1' | — |
| `created_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `model_profile` | TEXT | NOT NULL DEFAULT 'hse-emotion-mtl' | `0012_oyon_settings_runtime.sql` |
| `sample_interval_ms` | INTEGER | NOT NULL DEFAULT 1000 | `0012_oyon_settings_runtime.sql` |
| `window_ms` | INTEGER | NOT NULL DEFAULT 10000 | `0012_oyon_settings_runtime.sql` |
| `min_valid_frames` | INTEGER | NOT NULL DEFAULT 6 | `0012_oyon_settings_runtime.sql` |
| `smoothing_alpha` | REAL | NOT NULL DEFAULT 0.28 | `0012_oyon_settings_runtime.sql` |
| `min_hold_ms` | INTEGER | NOT NULL DEFAULT 3000 | `0012_oyon_settings_runtime.sql` |
| `min_switch_confidence` | REAL | NOT NULL DEFAULT 0.5 | `0012_oyon_settings_runtime.sql` |

## `panel_tests`

Stores panel tests records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `panel_id` | INTEGER | NOT NULL | — |
| `lab_test_id` | INTEGER | NOT NULL | — |
| `preset_type` | TEXT | CHECK(preset_type IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'custom')) DEFAULT 'normal' | — |
| `value_multiplier` | REAL | DEFAULT 1.0 | — |
| `custom_value` | REAL | — | — |
| `display_order` | INTEGER | DEFAULT 0 | — |

## `patient_information`

Stores patient information records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | NOT NULL UNIQUE | — |
| `first_name` | TEXT | — | — |
| `last_name` | TEXT | — | — |
| `date_of_birth` | DATE | — | — |
| `gender` | TEXT | CHECK(gender IN ('Male', 'Female', 'Other')) | — |
| `blood_type` | TEXT | — | — |
| `weight_kg` | REAL | — | — |
| `height_cm` | REAL | — | — |
| `chief_complaint` | TEXT | — | — |
| `history_of_present_illness` | TEXT | — | — |
| `past_medical_history` | TEXT | — | — |
| `surgical_history` | TEXT | — | — |
| `medications_list` | JSON | — | — |
| `allergies` | JSON | — | — |
| `social_history` | TEXT | — | — |
| `family_history` | TEXT | — | — |
| `review_of_systems` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `patient_record_documents`

Stores patient record documents records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL UNIQUE | — |
| `record_id` | TEXT | NOT NULL UNIQUE | — |
| `patient_info` | JSON | NOT NULL | — |
| `current_state` | JSON | — | — |
| `events_count` | INTEGER | DEFAULT 0 | — |
| `document` | JSON | NOT NULL | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `patient_record_events`

Stores patient record events records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `record_id` | TEXT | NOT NULL | — |
| `event_id` | TEXT | NOT NULL UNIQUE | — |
| `verb` | TEXT | NOT NULL CHECK(verb IN ('OBTAINED', 'EXAMINED', 'ELICITED', 'NOTED', 'ORDERED', 'ADMINISTERED', 'CHANGED', 'EXPRESSED')) | — |
| `time_elapsed` | INTEGER | NOT NULL | — |
| `category` | TEXT | — | — |
| `region` | TEXT | — | — |
| `source` | TEXT | — | — |
| `item` | TEXT | — | — |
| `content` | TEXT | — | — |
| `finding` | TEXT | — | — |
| `value` | TEXT | — | — |
| `unit` | TEXT | — | — |
| `abnormal` | BOOLEAN | — | — |
| `details` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `physical_exam_findings`

Stores physical exam findings records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `case_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | — | — |
| `body_region` | TEXT | NOT NULL | — |
| `exam_type` | TEXT | NOT NULL | — |
| `finding` | TEXT | NOT NULL | — |
| `is_abnormal` | BOOLEAN | DEFAULT 0 | — |
| `audio_url` | TEXT | — | — |
| `audio_played` | BOOLEAN | DEFAULT 0 | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `platform_settings`

Stores platform settings records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `setting_key` | TEXT | UNIQUE NOT NULL | — |
| `setting_value` | TEXT | — | — |
| `updated_by` | INTEGER | — | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `questionnaire_responses`

Stores questionnaire responses records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `user_id` | INTEGER | NOT NULL | — |
| `case_id` | INTEGER | — | — |
| `submitted_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `responses` | JSON | NOT NULL | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `region_default_findings`

Stores region default findings records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `region_id` | INTEGER | NOT NULL | — |
| `technique_id` | INTEGER | NOT NULL | — |
| `finding_text` | TEXT | NOT NULL | — |
| `is_normal` | BOOLEAN | DEFAULT 1 | — |

## `region_exam_types`

Stores region exam types records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `region_id` | INTEGER | NOT NULL | — |
| `technique_id` | INTEGER | NOT NULL | — |
| `is_primary` | BOOLEAN | DEFAULT 0 | — |

## `region_special_tests`

Stores region special tests records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `region_id` | INTEGER | NOT NULL | — |
| `test_name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `technique` | TEXT | — | — |
| `positive_finding` | TEXT | — | — |
| `negative_finding` | TEXT | — | — |
| `clinical_significance` | TEXT | — | — |

## `scenario_events`

Stores scenario events records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | NOT NULL | — |
| `session_id` | INTEGER | — | — |
| `event_type` | TEXT | NOT NULL | — |
| `event_name` | TEXT | — | — |
| `scheduled_minutes` | INTEGER | — | — |
| `vital_changes` | JSON | — | — |
| `message` | TEXT | — | — |
| `is_triggered` | BOOLEAN | DEFAULT 0 | — |
| `triggered_at` | DATETIME | — | — |
| `acknowledged_at` | DATETIME | — | — |
| `acknowledged_by` | INTEGER | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `scenario_templates`

Stores scenario templates records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_by, created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `template_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `category` | TEXT | — | — |
| `duration_minutes` | INTEGER | NOT NULL | — |
| `difficulty_level` | TEXT | CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')) | — |
| `clinical_condition` | TEXT | — | — |
| `learning_objectives` | JSON | — | — |
| `is_public` | BOOLEAN | DEFAULT 1 | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_by` | INTEGER | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |

## `scenario_timeline_points`

Stores scenario timeline points records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `scenario_id` | INTEGER | NOT NULL | — |
| `sequence_order` | INTEGER | NOT NULL | — |
| `time_minutes` | INTEGER | NOT NULL | — |
| `label` | TEXT | — | — |
| `description` | TEXT | — | — |
| `hr` | INTEGER | — | — |
| `spo2` | INTEGER | — | — |
| `rr` | INTEGER | — | — |
| `bp_sys` | INTEGER | — | — |
| `bp_dia` | INTEGER | — | — |
| `temp` | REAL | — | — |
| `etco2` | INTEGER | — | — |
| `cardiac_rhythm` | TEXT | — | — |
| `st_elevation` | BOOLEAN | DEFAULT 0 | — |
| `pvc_present` | BOOLEAN | DEFAULT 0 | — |
| `wide_qrs` | BOOLEAN | DEFAULT 0 | — |
| `t_inversion` | BOOLEAN | DEFAULT 0 | — |
| `noise_level` | REAL | DEFAULT 0 | — |
| `additional_params` | JSON | — | — |

## `scenarios`

Stores scenarios records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_by, created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `duration_minutes` | INTEGER | NOT NULL | — |
| `category` | TEXT | — | — |
| `timeline` | JSON | NOT NULL | — |
| `created_by` | INTEGER | — | — |
| `is_public` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |
| `deleted_at` | DATETIME | — | `0005_retention.sql` |

## `search_aliases`

Stores search aliases records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `alias_term` | TEXT | NOT NULL | — |
| `alias_type` | TEXT | CHECK(alias_type IN ('lab', 'medication', 'investigation', 'panel', 'diagnosis')) NOT NULL | — |
| `target_ids` | JSON | NOT NULL | — |
| `description` | TEXT | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |

## `session_notes`

Stores session notes records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `session_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | NOT NULL | — |
| `note_text` | TEXT | NOT NULL DEFAULT '' | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `session_settings`

Stores session settings records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `snapshot (settings_snapshot)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | — | — |
| `case_id` | INTEGER | — | — |
| `user_id` | INTEGER | — | — |
| `llm_provider` | TEXT | — | — |
| `llm_model` | TEXT | — | — |
| `llm_base_url` | TEXT | — | — |
| `monitor_hr` | INTEGER | — | — |
| `monitor_rhythm` | TEXT | — | — |
| `monitor_spo2` | INTEGER | — | — |
| `monitor_bp_sys` | INTEGER | — | — |
| `monitor_bp_dia` | INTEGER | — | — |
| `monitor_rr` | INTEGER | — | — |
| `monitor_temp` | REAL | — | — |
| `settings_snapshot` | JSON | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `session_vitals`

Stores session vitals records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `elapsed_ms` | INTEGER | — | — |
| `hr` | REAL | — | — |
| `rhythm` | TEXT | — | — |
| `spo2` | REAL | — | — |
| `bp_sys` | REAL | — | — |
| `bp_dia` | REAL | — | — |
| `rr` | REAL | — | — |
| `temp` | REAL | — | — |
| `etco2` | REAL | — | — |
| `source` | TEXT | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `sessions`

Stores sessions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (updated_at)` · `snapshot (case_snapshot)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `case_id` | INTEGER | — | — |
| `user_id` | INTEGER | — | — |
| `student_name` | TEXT | — | — |
| `start_time` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `end_time` | DATETIME | — | — |
| `duration` | INTEGER | — | — |
| `status` | TEXT | CHECK(status IN ('active', 'paused', 'completed', 'abandoned')) DEFAULT 'active' | — |
| `case_version` | INTEGER | — | — |
| `exam_findings_count` | INTEGER | DEFAULT 0 | — |
| `investigation_count` | INTEGER | DEFAULT 0 | — |
| `message_count` | INTEGER | DEFAULT 0 | — |
| `performance_score` | REAL | — | — |
| `instructor_notes` | TEXT | — | — |
| `monitor_settings` | JSON | — | — |
| `llm_settings` | JSON | — | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `case_snapshot` | JSON | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `settings_logs`

Stores settings logs records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | — | — |
| `session_id` | INTEGER | — | — |
| `case_id` | INTEGER | — | — |
| `setting_type` | TEXT | CHECK(setting_type IN ('llm', 'monitor', 'case_load')) NOT NULL | — |
| `setting_name` | TEXT | — | — |
| `old_value` | TEXT | — | — |
| `new_value` | TEXT | — | — |
| `settings_json` | JSON | — | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `system_audit_log`

Stores system audit log records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `timestamp` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `user_id` | INTEGER | — | — |
| `username` | TEXT | — | — |
| `action` | TEXT | NOT NULL | — |
| `resource_type` | TEXT | — | — |
| `resource_id` | TEXT | — | — |
| `resource_name` | TEXT | — | — |
| `old_value` | TEXT | — | — |
| `new_value` | TEXT | — | — |
| `ip_address` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `session_id` | INTEGER | — | — |
| `status` | TEXT | CHECK(status IN ('success', 'failure', 'warning')) DEFAULT 'success' | — |
| `error_message` | TEXT | — | — |
| `metadata` | JSON | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `team_communications_log`

Stores team communications log records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `agent_type` | TEXT | NOT NULL | — |
| `key_points` | TEXT | NOT NULL | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `tenants`

Stores tenants records.

**Introduced by:** migration `0004_tenants.sql`

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `slug` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `is_default` | BOOLEAN | DEFAULT 0 | — |

## `treatment_effects`

Stores treatment effects records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `audit (created_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `medication_id` | INTEGER | — | — |
| `treatment_type` | TEXT | NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')) | — |
| `treatment_name` | TEXT | NOT NULL | — |
| `route` | TEXT | — | — |
| `onset_minutes` | REAL | NOT NULL DEFAULT 5 | — |
| `peak_minutes` | REAL | NOT NULL DEFAULT 15 | — |
| `duration_minutes` | REAL | NOT NULL DEFAULT 60 | — |
| `hr_effect` | INTEGER | DEFAULT 0 | — |
| `bp_sys_effect` | INTEGER | DEFAULT 0 | — |
| `bp_dia_effect` | INTEGER | DEFAULT 0 | — |
| `rr_effect` | INTEGER | DEFAULT 0 | — |
| `spo2_effect` | INTEGER | DEFAULT 0 | — |
| `temp_effect` | REAL | DEFAULT 0 | — |
| `etco2_effect` | INTEGER | DEFAULT 0 | — |
| `dose_dependent` | BOOLEAN | DEFAULT 0 | — |
| `base_dose` | REAL | — | — |
| `base_dose_unit` | TEXT | — | — |
| `max_effect_multiplier` | REAL | DEFAULT 2.0 | — |
| `description` | TEXT | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `rxcui` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `data_source_id` | INTEGER | REFERENCES data_sources(id) | `0007_drug_lab_catalogue.sql` |
| `pk_source` | TEXT | — | `0007_drug_lab_catalogue.sql` |
| `pk_evidence_url` | TEXT | — | `0007_drug_lab_catalogue.sql` |

## `treatment_orders`

Stores treatment orders records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `treatment_type` | TEXT | NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')) | — |
| `medication_id` | INTEGER | — | — |
| `treatment_item` | TEXT | NOT NULL | — |
| `dose` | TEXT | — | — |
| `dose_value` | REAL | — | — |
| `dose_unit` | TEXT | — | — |
| `route` | TEXT | — | — |
| `frequency` | TEXT | — | — |
| `rate` | TEXT | — | — |
| `rate_value` | REAL | — | — |
| `rate_unit` | TEXT | — | — |
| `duration_minutes` | INTEGER | — | — |
| `urgency` | TEXT | CHECK(urgency IN ('stat', 'routine', 'prn')) DEFAULT 'routine' | — |
| `is_high_alert` | BOOLEAN | DEFAULT 0 | — |
| `ordered_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `administered_at` | DATETIME | — | — |
| `completed_at` | DATETIME | — | — |
| `discontinued_at` | DATETIME | — | — |
| `status` | TEXT | CHECK(status IN ('ordered', 'administered', 'in_progress', 'completed', 'discontinued', 'held')) DEFAULT 'ordered' | — |
| `notes` | TEXT | — | — |
| `feedback` | TEXT | — | — |
| `points_awarded` | INTEGER | DEFAULT 0 | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `tts_usage`

Stores tts usage records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL | — |
| `date` | DATE | NOT NULL | — |
| `provider` | TEXT | NOT NULL | — |
| `char_count` | INTEGER | DEFAULT 0 | — |
| `request_count` | INTEGER | DEFAULT 0 | — |
| `estimated_cost` | REAL | DEFAULT 0 | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `usage_budget`

Stores usage budget records.

**Introduced by:** migration `0010_usage_budget.sql`

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `tenant_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | — | — |
| `provider` | TEXT | NOT NULL | — |
| `metric` | TEXT | NOT NULL | — |
| `window_start` | DATETIME | NOT NULL | — |
| `window_end` | DATETIME | NOT NULL | — |
| `used` | INTEGER | NOT NULL DEFAULT 0 | — |

## `user_preferences`

Stores user preferences records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `user_id` | INTEGER | NOT NULL UNIQUE | — |
| `theme` | TEXT | DEFAULT 'dark' | — |
| `language` | TEXT | DEFAULT 'en' | — |
| `notification_settings` | JSON | — | — |
| `dashboard_layout` | JSON | — | — |
| `default_llm_settings` | JSON | — | — |
| `default_monitor_settings` | JSON | — | — |
| `accessibility_settings` | JSON | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `users`

Stores users records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `soft-delete` · `tenant-scoped` · `audit (created_at, updated_at)`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `username` | TEXT | NOT NULL UNIQUE | — |
| `name` | TEXT | — | — |
| `password_hash` | TEXT | NOT NULL | — |
| `email` | TEXT | NOT NULL UNIQUE | — |
| `role` | TEXT | NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user' | — |
| `department` | TEXT | — | — |
| `status` | TEXT | CHECK(status IN ('active', 'inactive', 'suspended')) DEFAULT 'active' | — |
| `last_login` | DATETIME | — | — |
| `failed_login_attempts` | INTEGER | DEFAULT 0 | — |
| `locked_until` | DATETIME | — | — |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `deleted_at` | DATETIME | — | — |
| `institution` | TEXT | — | — |
| `address` | TEXT | — | — |
| `phone` | TEXT | — | — |
| `alternative_email` | TEXT | — | — |
| `education` | TEXT | — | — |
| `grade` | TEXT | — | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

## `vital_sign_definitions`

Stores vital sign definitions records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `vital_id` | TEXT | UNIQUE NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `abbreviation` | TEXT | — | — |
| `unit` | TEXT | NOT NULL | — |
| `normal_min` | REAL | — | — |
| `normal_max` | REAL | — | — |
| `critical_low` | REAL | — | — |
| `critical_high` | REAL | — | — |
| `alarm_low` | REAL | — | — |
| `alarm_high` | REAL | — | — |
| `decimal_places` | INTEGER | DEFAULT 0 | — |
| `display_order` | INTEGER | DEFAULT 0 | — |
| `color_code` | TEXT | — | — |
| `is_active` | BOOLEAN | DEFAULT 1 | — |

## `vital_sign_history`

Stores vital sign history records.

**Introduced by:** base schema (`migrations/0001_initial.sql`)

**Cross-cutting:** `tenant-scoped`

| Column | Type | Constraints | Added by |
| --- | --- | --- | --- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — |
| `session_id` | INTEGER | NOT NULL | — |
| `vital_sign` | TEXT | NOT NULL | — |
| `value` | REAL | NOT NULL | — |
| `unit` | TEXT | — | — |
| `is_alarm_triggered` | BOOLEAN | DEFAULT 0 | — |
| `alarm_type` | TEXT | — | — |
| `recorded_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | — |
| `source` | TEXT | DEFAULT 'system' | — |
| `tenant_id` | INTEGER | NOT NULL DEFAULT 1 | `0004_tenants.sql` |

---

_Regenerate: `npm run docs:gen:data`_
