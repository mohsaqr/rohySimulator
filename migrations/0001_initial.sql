-- Baseline schema extracted from the pre-E2 server/db.js bootstrap.
-- Data/default seeding remains in server/db.js by design.

CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        name TEXT,
        password_hash TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
        department TEXT,
        status TEXT CHECK(status IN ('active', 'inactive', 'suspended')) DEFAULT 'active',
        last_login DATETIME,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
    , institution TEXT, address TEXT, phone TEXT, alternative_email TEXT, education TEXT, grade TEXT);
CREATE TABLE cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            system_prompt TEXT,
            config JSON,
            patient_name TEXT,
            patient_gender TEXT CHECK(patient_gender IN ('Male', 'Female', 'Other')),
            patient_age INTEGER,
            chief_complaint TEXT,
            difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')),
            estimated_duration_minutes INTEGER,
            learning_objectives JSON,
            version INTEGER DEFAULT 1,
            is_available BOOLEAN DEFAULT 0,
            is_default BOOLEAN DEFAULT 0,
            is_published BOOLEAN DEFAULT 0,
            published_at DATETIME,
            scenario JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            last_modified_by INTEGER,
            deleted_at DATETIME,
            FOREIGN KEY(created_by) REFERENCES users(id),
            FOREIGN KEY(last_modified_by) REFERENCES users(id)
        );
CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER,
            user_id INTEGER,
            student_name TEXT,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            duration INTEGER,
            status TEXT CHECK(status IN ('active', 'paused', 'completed', 'abandoned')) DEFAULT 'active',
            case_version INTEGER,
            exam_findings_count INTEGER DEFAULT 0,
            investigation_count INTEGER DEFAULT 0,
            message_count INTEGER DEFAULT 0,
            performance_score REAL,
            instructor_notes TEXT,
            monitor_settings JSON,
            llm_settings JSON,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME, case_snapshot JSON,
            FOREIGN KEY(case_id) REFERENCES cases(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            role TEXT CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, deleted_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
CREATE TABLE login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            action TEXT CHECK(action IN ('login', 'logout', 'failed_login')) NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE settings_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            session_id INTEGER,
            case_id INTEGER,
            setting_type TEXT CHECK(setting_type IN ('llm', 'monitor', 'case_load')) NOT NULL,
            setting_name TEXT,
            old_value TEXT,
            new_value TEXT,
            settings_json JSON,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(case_id) REFERENCES cases(id)
        );
CREATE TABLE session_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            case_id INTEGER,
            user_id INTEGER,
            llm_provider TEXT,
            llm_model TEXT,
            llm_base_url TEXT,
            monitor_hr INTEGER,
            monitor_rhythm TEXT,
            monitor_spo2 INTEGER,
            monitor_bp_sys INTEGER,
            monitor_bp_dia INTEGER,
            monitor_rr INTEGER,
            monitor_temp REAL,
            settings_snapshot JSON,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(case_id) REFERENCES cases(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE event_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            event_type TEXT,
            description TEXT,
            vital_sign TEXT,
            old_value TEXT,
            new_value TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, user_id INTEGER REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
CREATE TABLE alarm_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            vital_sign TEXT,
            threshold_type TEXT,
            threshold_value REAL,
            actual_value REAL,
            triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            acknowledged_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
CREATE TABLE alarm_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            vital_sign TEXT,
            high_threshold REAL,
            low_threshold REAL,
            enabled BOOLEAN DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE case_investigations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER,
            investigation_type TEXT,
            test_name TEXT,
            result_data JSON,
            image_url TEXT,
            turnaround_minutes INTEGER DEFAULT 30, test_group TEXT, gender_category TEXT, unit TEXT, normal_samples JSON, is_abnormal BOOLEAN DEFAULT 0, current_value REAL, min_value REAL, max_value REAL,
            FOREIGN KEY(case_id) REFERENCES cases(id)
        );
CREATE TABLE investigation_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            investigation_id INTEGER,
            ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            available_at DATETIME,
            viewed_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(investigation_id) REFERENCES case_investigations(id)
        );
CREATE TABLE platform_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT,
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(updated_by) REFERENCES users(id)
        );
CREATE TABLE scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL,
            category TEXT,
            timeline JSON NOT NULL,
            created_by INTEGER,
            is_public BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );
CREATE TABLE learning_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            user_id INTEGER,
            case_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,

            -- xAPI-style action verbs
            verb TEXT NOT NULL,

            -- Object being acted upon
            object_type TEXT NOT NULL,
            object_id TEXT,
            object_name TEXT,

            -- Context
            component TEXT,
            parent_component TEXT,

            -- Result/Details
            result TEXT,
            duration_ms INTEGER,

            -- Additional context as JSON
            context JSON,

            -- Chat content (when verb is SENT_MESSAGE or RECEIVED_MESSAGE)
            message_content TEXT,
            message_role TEXT,

            -- Severity and category for filtering
            severity TEXT CHECK(severity IN ('DEBUG', 'INFO', 'ACTION', 'IMPORTANT', 'CRITICAL')),
            category TEXT CHECK(category IN ('SESSION', 'NAVIGATION', 'CLINICAL', 'COMMUNICATION', 'MONITORING', 'CONFIGURATION', 'ASSESSMENT', 'ERROR')),

            -- Foreign keys
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(case_id) REFERENCES cases(id)
        );
CREATE TABLE physical_exam_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            case_id INTEGER NOT NULL,
            user_id INTEGER,
            body_region TEXT NOT NULL,
            exam_type TEXT NOT NULL,
            finding TEXT NOT NULL,
            is_abnormal BOOLEAN DEFAULT 0,
            audio_url TEXT,
            audio_played BOOLEAN DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE patient_information (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL UNIQUE,
            first_name TEXT,
            last_name TEXT,
            date_of_birth DATE,
            gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
            blood_type TEXT,
            weight_kg REAL,
            height_cm REAL,
            chief_complaint TEXT,
            history_of_present_illness TEXT,
            past_medical_history TEXT,
            surgical_history TEXT,
            medications_list JSON,
            allergies JSON,
            social_history TEXT,
            family_history TEXT,
            review_of_systems JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
        );
CREATE TABLE case_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            changed_by INTEGER NOT NULL,
            change_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            change_type TEXT CHECK(change_type IN ('created', 'updated', 'restored', 'published', 'unpublished')),
            changes_description TEXT,
            config_snapshot JSON NOT NULL,
            previous_version_id INTEGER,
            UNIQUE(case_id, version_number),
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(changed_by) REFERENCES users(id),
            FOREIGN KEY(previous_version_id) REFERENCES case_versions(id)
        );
CREATE TABLE system_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            username TEXT,
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            resource_name TEXT,
            old_value TEXT,
            new_value TEXT,
            ip_address TEXT,
            user_agent TEXT,
            session_id INTEGER,
            status TEXT CHECK(status IN ('success', 'failure', 'warning')) DEFAULT 'success',
            error_message TEXT,
            metadata JSON,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE lab_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_name TEXT NOT NULL,
            test_group TEXT NOT NULL,
            category TEXT CHECK(category IN ('Male', 'Female', 'Both')) DEFAULT 'Both',
            min_value REAL NOT NULL,
            max_value REAL NOT NULL,
            unit TEXT NOT NULL,
            normal_samples JSON,
            description TEXT,
            clinical_significance TEXT,
            turnaround_minutes INTEGER DEFAULT 30,
            cost REAL,
            version INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(test_name, category),
            FOREIGN KEY(created_by) REFERENCES users(id)
        );
CREATE TABLE vital_sign_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            vital_sign TEXT NOT NULL,
            value REAL NOT NULL,
            unit TEXT,
            is_alarm_triggered BOOLEAN DEFAULT 0,
            alarm_type TEXT,
            recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            source TEXT DEFAULT 'system',
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE TABLE export_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            export_type TEXT NOT NULL,
            export_format TEXT,
            resource_type TEXT,
            resource_ids JSON,
            record_count INTEGER,
            file_name TEXT,
            file_size_bytes INTEGER,
            file_hash TEXT,
            exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            filters_applied JSON,
            notes TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE active_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER,
            token_hash TEXT UNIQUE,
            login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            ip_address TEXT,
            user_agent TEXT,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
CREATE TABLE scenario_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            session_id INTEGER,
            event_type TEXT NOT NULL,
            event_name TEXT,
            scheduled_minutes INTEGER,
            vital_changes JSON,
            message TEXT,
            is_triggered BOOLEAN DEFAULT 0,
            triggered_at DATETIME,
            acknowledged_at DATETIME,
            acknowledged_by INTEGER,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(acknowledged_by) REFERENCES users(id)
        );
CREATE TABLE user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            theme TEXT DEFAULT 'dark',
            language TEXT DEFAULT 'en',
            notification_settings JSON,
            dashboard_layout JSON,
            default_llm_settings JSON,
            default_monitor_settings JSON,
            accessibility_settings JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
CREATE TABLE clinical_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            note_type TEXT CHECK(note_type IN ('subjective', 'objective', 'assessment', 'plan', 'general')) DEFAULT 'general',
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE exam_techniques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            technique_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            icon TEXT,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE body_regions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            anatomical_view TEXT CHECK(anatomical_view IN ('anterior', 'posterior', 'both', 'special')) DEFAULT 'both',
            description TEXT,
            parent_region_id INTEGER,
            display_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(parent_region_id) REFERENCES body_regions(id)
        );
CREATE TABLE region_exam_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            technique_id INTEGER NOT NULL,
            is_primary BOOLEAN DEFAULT 0,
            UNIQUE(region_id, technique_id),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE,
            FOREIGN KEY(technique_id) REFERENCES exam_techniques(id) ON DELETE CASCADE
        );
CREATE TABLE region_special_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            test_name TEXT NOT NULL,
            description TEXT,
            technique TEXT,
            positive_finding TEXT,
            negative_finding TEXT,
            clinical_significance TEXT,
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE
        );
CREATE TABLE region_default_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            technique_id INTEGER NOT NULL,
            finding_text TEXT NOT NULL,
            is_normal BOOLEAN DEFAULT 1,
            UNIQUE(region_id, technique_id),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE,
            FOREIGN KEY(technique_id) REFERENCES exam_techniques(id) ON DELETE CASCADE
        );
CREATE TABLE body_map_coordinates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_id INTEGER NOT NULL,
            gender TEXT CHECK(gender IN ('male', 'female', 'unisex')) DEFAULT 'unisex',
            view TEXT CHECK(view IN ('anterior', 'posterior')) NOT NULL,
            polygon_points JSON NOT NULL,
            color_code TEXT,
            hover_color TEXT,
            selected_color TEXT,
            is_clickable BOOLEAN DEFAULT 1,
            z_index INTEGER DEFAULT 0,
            UNIQUE(region_id, gender, view),
            FOREIGN KEY(region_id) REFERENCES body_regions(id) ON DELETE CASCADE
        );
CREATE TABLE scenario_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            duration_minutes INTEGER NOT NULL,
            difficulty_level TEXT CHECK(difficulty_level IN ('beginner', 'intermediate', 'advanced')),
            clinical_condition TEXT,
            learning_objectives JSON,
            is_public BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );
CREATE TABLE scenario_timeline_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER NOT NULL,
            sequence_order INTEGER NOT NULL,
            time_minutes INTEGER NOT NULL,
            label TEXT,
            description TEXT,
            hr INTEGER,
            spo2 INTEGER,
            rr INTEGER,
            bp_sys INTEGER,
            bp_dia INTEGER,
            temp REAL,
            etco2 INTEGER,
            cardiac_rhythm TEXT,
            st_elevation BOOLEAN DEFAULT 0,
            pvc_present BOOLEAN DEFAULT 0,
            wide_qrs BOOLEAN DEFAULT 0,
            t_inversion BOOLEAN DEFAULT 0,
            noise_level REAL DEFAULT 0,
            additional_params JSON,
            UNIQUE(scenario_id, sequence_order),
            FOREIGN KEY(scenario_id) REFERENCES scenario_templates(id) ON DELETE CASCADE
        );
CREATE TABLE lab_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            test_code TEXT UNIQUE,
            test_name TEXT NOT NULL,
            test_group TEXT NOT NULL,
            category TEXT CHECK(category IN ('General', 'Male', 'Female')) DEFAULT 'General',
            specimen_type TEXT,
            min_value REAL,
            max_value REAL,
            unit TEXT NOT NULL,
            critical_low REAL,
            critical_high REAL,
            normal_samples JSON,
            description TEXT,
            clinical_significance TEXT,
            turnaround_minutes INTEGER DEFAULT 30,
            cost REAL,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE lab_panels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id TEXT UNIQUE NOT NULL,
            panel_name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            clinical_indication TEXT,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE panel_tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id INTEGER NOT NULL,
            lab_test_id INTEGER NOT NULL,
            preset_type TEXT CHECK(preset_type IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'custom')) DEFAULT 'normal',
            value_multiplier REAL DEFAULT 1.0,
            custom_value REAL,
            display_order INTEGER DEFAULT 0,
            UNIQUE(panel_id, lab_test_id),
            FOREIGN KEY(panel_id) REFERENCES lab_panels(id) ON DELETE CASCADE,
            FOREIGN KEY(lab_test_id) REFERENCES lab_tests(id) ON DELETE CASCADE
        );
CREATE TABLE investigation_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            investigation_type TEXT CHECK(investigation_type IN ('lab', 'radiology', 'procedure', 'other')) NOT NULL,
            turnaround_minutes INTEGER DEFAULT 30,
            description TEXT,
            preparation_instructions TEXT,
            contraindications TEXT,
            cost REAL,
            is_stat_available BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE investigation_parameters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            investigation_id INTEGER NOT NULL,
            parameter_name TEXT NOT NULL,
            unit TEXT,
            normal_range_min REAL,
            normal_range_max REAL,
            critical_low REAL,
            critical_high REAL,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(investigation_id) REFERENCES investigation_templates(id) ON DELETE CASCADE
        );
CREATE TABLE investigation_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            investigation_id INTEGER NOT NULL,
            view_name TEXT NOT NULL,
            description TEXT,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(investigation_id) REFERENCES investigation_templates(id) ON DELETE CASCADE
        );
CREATE TABLE medications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medication_code TEXT UNIQUE,
            generic_name TEXT NOT NULL,
            brand_names JSON,
            drug_class TEXT,
            category TEXT,
            route TEXT CHECK(route IN ('oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'sublingual', 'rectal', 'other')),
            typical_dose TEXT,
            dose_unit TEXT,
            frequency TEXT,
            max_daily_dose TEXT,
            onset_minutes INTEGER,
            duration_minutes INTEGER,
            half_life_hours REAL,
            indications JSON,
            contraindications JSON,
            side_effects JSON,
            interactions JSON,
            monitoring_parameters JSON,
            pregnancy_category TEXT,
            is_controlled BOOLEAN DEFAULT 0,
            is_high_alert BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE medication_doses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medication_id INTEGER NOT NULL,
            dose_description TEXT NOT NULL,
            dose_value REAL,
            dose_unit TEXT,
            route TEXT,
            frequency TEXT,
            indication TEXT,
            is_default BOOLEAN DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            FOREIGN KEY(medication_id) REFERENCES medications(id) ON DELETE CASCADE
        );
CREATE TABLE search_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alias_term TEXT NOT NULL,
            alias_type TEXT CHECK(alias_type IN ('lab', 'medication', 'investigation', 'panel', 'diagnosis')) NOT NULL,
            target_ids JSON NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT 1,
            UNIQUE(alias_term, alias_type)
        );
CREATE TABLE vital_sign_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vital_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            abbreviation TEXT,
            unit TEXT NOT NULL,
            normal_min REAL,
            normal_max REAL,
            critical_low REAL,
            critical_high REAL,
            alarm_low REAL,
            alarm_high REAL,
            decimal_places INTEGER DEFAULT 0,
            display_order INTEGER DEFAULT 0,
            color_code TEXT,
            is_active BOOLEAN DEFAULT 1
        );
CREATE TABLE diagnoses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            icd_code TEXT,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            body_system TEXT,
            severity TEXT CHECK(severity IN ('mild', 'moderate', 'severe', 'critical')),
            typical_findings JSON,
            differential_diagnoses JSON,
            workup_recommendations JSON,
            treatment_guidelines JSON,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE clinical_pathways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pathway_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            condition_id INTEGER,
            steps JSON NOT NULL,
            duration_hours INTEGER,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(condition_id) REFERENCES diagnoses(id)
        );
CREATE TABLE llm_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date DATE NOT NULL,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            model TEXT,
            request_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE llm_request_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id INTEGER,
            model TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            estimated_cost REAL,
            status TEXT CHECK(status IN ('success', 'error', 'rate_limited')) DEFAULT 'success',
            error_message TEXT,
            request_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            response_time_ms INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        );
CREATE TABLE llm_model_pricing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_cost_per_1k REAL NOT NULL,
            output_cost_per_1k REAL NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider, model)
        );
CREATE TABLE patient_record_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            record_id TEXT NOT NULL,
            event_id TEXT NOT NULL UNIQUE,
            verb TEXT NOT NULL CHECK(verb IN ('OBTAINED', 'EXAMINED', 'ELICITED', 'NOTED', 'ORDERED', 'ADMINISTERED', 'CHANGED', 'EXPRESSED')),
            time_elapsed INTEGER NOT NULL,
            category TEXT,
            region TEXT,
            source TEXT,
            item TEXT,
            content TEXT,
            finding TEXT,
            value TEXT,
            unit TEXT,
            abnormal BOOLEAN,
            details JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE TABLE patient_record_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE,
            record_id TEXT NOT NULL UNIQUE,
            patient_info JSON NOT NULL,
            current_state JSON,
            events_count INTEGER DEFAULT 0,
            document JSON NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE TABLE agent_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_type TEXT NOT NULL,
            name TEXT NOT NULL,
            role_title TEXT,
            avatar_url TEXT,
            system_prompt TEXT NOT NULL,
            context_filter TEXT DEFAULT 'full',
            communication_style TEXT,
            is_default BOOLEAN DEFAULT 0,
            config JSON,
            -- LLM Configuration (optional override from platform default)
            llm_provider TEXT,
            llm_model TEXT,
            llm_api_key TEXT,
            llm_endpoint TEXT,
            llm_config JSON,
            -- Memory/PatientRecord Access Configuration
            memory_access JSON,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, llm_temperature REAL, llm_max_tokens INTEGER,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );
CREATE TABLE case_agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            agent_template_id INTEGER NOT NULL,
            enabled BOOLEAN DEFAULT 1,
            name_override TEXT,
            system_prompt_override TEXT,
            availability_type TEXT DEFAULT 'present',
            available_from_minute INTEGER DEFAULT 0,
            auto_arrive_minute INTEGER,
            depart_at_minute INTEGER,
            response_time_min INTEGER DEFAULT 0,
            response_time_max INTEGER DEFAULT 0,
            config_override JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(agent_template_id) REFERENCES agent_templates(id)
        );
CREATE TABLE agent_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE TABLE agent_session_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            status TEXT DEFAULT 'absent',
            paged_at DATETIME,
            arrived_at DATETIME,
            departed_at DATETIME,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            UNIQUE(session_id, agent_type)
        );
CREATE TABLE team_communications_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            agent_type TEXT NOT NULL,
            key_points TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE TABLE treatment_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            treatment_type TEXT NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')),
            medication_id INTEGER,
            treatment_item TEXT NOT NULL,
            dose TEXT,
            dose_value REAL,
            dose_unit TEXT,
            route TEXT,
            frequency TEXT,
            rate TEXT,
            rate_value REAL,
            rate_unit TEXT,
            duration_minutes INTEGER,
            urgency TEXT CHECK(urgency IN ('stat', 'routine', 'prn')) DEFAULT 'routine',
            is_high_alert BOOLEAN DEFAULT 0,
            ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            administered_at DATETIME,
            completed_at DATETIME,
            discontinued_at DATETIME,
            status TEXT CHECK(status IN ('ordered', 'administered', 'in_progress', 'completed', 'discontinued', 'held')) DEFAULT 'ordered',
            notes TEXT,
            feedback TEXT,
            points_awarded INTEGER DEFAULT 0,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(medication_id) REFERENCES medications(id)
        );
CREATE TABLE treatment_effects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medication_id INTEGER,
            treatment_type TEXT NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')),
            treatment_name TEXT NOT NULL,
            route TEXT,
            onset_minutes REAL NOT NULL DEFAULT 5,
            peak_minutes REAL NOT NULL DEFAULT 15,
            duration_minutes REAL NOT NULL DEFAULT 60,
            hr_effect INTEGER DEFAULT 0,
            bp_sys_effect INTEGER DEFAULT 0,
            bp_dia_effect INTEGER DEFAULT 0,
            rr_effect INTEGER DEFAULT 0,
            spo2_effect INTEGER DEFAULT 0,
            temp_effect REAL DEFAULT 0,
            etco2_effect INTEGER DEFAULT 0,
            dose_dependent BOOLEAN DEFAULT 0,
            base_dose REAL,
            base_dose_unit TEXT,
            max_effect_multiplier REAL DEFAULT 2.0,
            description TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(treatment_name, route),
            FOREIGN KEY(medication_id) REFERENCES medications(id)
        );
CREATE TABLE active_treatments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            treatment_order_id INTEGER NOT NULL,
            effect_id INTEGER,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            phase TEXT CHECK(phase IN ('onset', 'peak', 'decline', 'expired')) DEFAULT 'onset',
            current_effect_strength REAL DEFAULT 0,
            dose_multiplier REAL DEFAULT 1.0,
            peak_hr_effect INTEGER DEFAULT 0,
            peak_bp_sys_effect INTEGER DEFAULT 0,
            peak_bp_dia_effect INTEGER DEFAULT 0,
            peak_rr_effect INTEGER DEFAULT 0,
            peak_spo2_effect INTEGER DEFAULT 0,
            peak_temp_effect REAL DEFAULT 0,
            peak_etco2_effect INTEGER DEFAULT 0,
            expires_at DATETIME,
            is_continuous BOOLEAN DEFAULT 0,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(treatment_order_id) REFERENCES treatment_orders(id) ON DELETE CASCADE,
            FOREIGN KEY(effect_id) REFERENCES treatment_effects(id)
        );
CREATE TABLE case_treatments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id INTEGER NOT NULL,
            treatment_type TEXT NOT NULL CHECK(treatment_type IN ('medication', 'iv_fluid', 'oxygen', 'nursing')),
            medication_id INTEGER,
            treatment_name TEXT NOT NULL,
            is_available BOOLEAN DEFAULT 1,
            is_expected BOOLEAN DEFAULT 0,
            is_contraindicated BOOLEAN DEFAULT 0,
            points_if_ordered INTEGER DEFAULT 0,
            feedback_if_ordered TEXT,
            feedback_if_missed TEXT,
            custom_effect_override JSON,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
            FOREIGN KEY(medication_id) REFERENCES medications(id)
        );
CREATE TABLE emotion_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            user_id INTEGER,
            case_id INTEGER,
            emotion TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(case_id) REFERENCES cases(id)
        );
CREATE TABLE questionnaire_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            user_id INTEGER NOT NULL,
            case_id INTEGER,
            submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            responses JSON NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
        );
CREATE TABLE tts_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date DATE NOT NULL,
            provider TEXT NOT NULL,
            char_count INTEGER DEFAULT 0,
            request_count INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date, provider),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
CREATE TABLE session_notes (
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            note_text TEXT NOT NULL DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (session_id, user_id),
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
CREATE TABLE session_vitals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            elapsed_ms INTEGER,
            hr REAL,
            rhythm TEXT,
            spo2 REAL,
            bp_sys REAL,
            bp_dia REAL,
            rr REAL,
            temp REAL,
            etco2 REAL,
            source TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
CREATE INDEX idx_learning_events_session ON learning_events(session_id);
CREATE INDEX idx_learning_events_user ON learning_events(user_id);
CREATE INDEX idx_learning_events_verb ON learning_events(verb);
CREATE INDEX idx_learning_events_timestamp ON learning_events(timestamp);
CREATE INDEX idx_learning_events_case_id ON learning_events(case_id);
CREATE INDEX idx_learning_events_object_type ON learning_events(object_type);
CREATE INDEX idx_learning_events_composite ON learning_events(session_id, timestamp);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_case_id ON sessions(case_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_start_time ON sessions(start_time DESC);
CREATE INDEX idx_sessions_composite ON sessions(user_id, case_id);
CREATE INDEX idx_cases_is_available ON cases(is_available);
CREATE INDEX idx_cases_is_default ON cases(is_default);
CREATE INDEX idx_cases_created_at ON cases(created_at DESC);
CREATE INDEX idx_cases_difficulty ON cases(difficulty_level);
CREATE INDEX idx_interactions_session_id ON interactions(session_id);
CREATE INDEX idx_interactions_timestamp ON interactions(timestamp);
CREATE INDEX idx_investigation_orders_session_id ON investigation_orders(session_id);
CREATE INDEX idx_investigation_orders_viewed_at ON investigation_orders(viewed_at);
CREATE INDEX idx_login_logs_user_id ON login_logs(user_id);
CREATE INDEX idx_login_logs_timestamp ON login_logs(timestamp DESC);
CREATE INDEX idx_login_logs_action ON login_logs(action);
CREATE INDEX idx_settings_logs_user_id ON settings_logs(user_id);
CREATE INDEX idx_settings_logs_timestamp ON settings_logs(timestamp DESC);
CREATE INDEX idx_physical_exam_session ON physical_exam_findings(session_id);
CREATE INDEX idx_physical_exam_case ON physical_exam_findings(case_id);
CREATE INDEX idx_physical_exam_region ON physical_exam_findings(body_region);
CREATE INDEX idx_audit_log_user ON system_audit_log(user_id);
CREATE INDEX idx_audit_log_timestamp ON system_audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_resource ON system_audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_action ON system_audit_log(action);
CREATE INDEX idx_case_versions_case ON case_versions(case_id);
CREATE INDEX idx_case_versions_timestamp ON case_versions(change_timestamp DESC);
CREATE INDEX idx_vital_history_session ON vital_sign_history(session_id);
CREATE INDEX idx_vital_history_composite ON vital_sign_history(session_id, recorded_at);
CREATE INDEX idx_active_sessions_user ON active_sessions(user_id);
CREATE INDEX idx_active_sessions_token ON active_sessions(token_hash);
CREATE INDEX idx_lab_definitions_name ON lab_definitions(test_name);
CREATE INDEX idx_lab_definitions_group ON lab_definitions(test_group);
CREATE INDEX idx_alarm_events_session_id ON alarm_events(session_id);
CREATE INDEX idx_alarm_events_triggered ON alarm_events(triggered_at);
CREATE INDEX idx_clinical_notes_session ON clinical_notes(session_id);
CREATE INDEX idx_clinical_notes_user ON clinical_notes(user_id);
CREATE INDEX idx_body_regions_region_id ON body_regions(region_id);
CREATE INDEX idx_body_regions_view ON body_regions(anatomical_view);
CREATE INDEX idx_body_map_region ON body_map_coordinates(region_id);
CREATE INDEX idx_body_map_gender_view ON body_map_coordinates(gender, view);
CREATE INDEX idx_scenario_templates_id ON scenario_templates(template_id);
CREATE INDEX idx_scenario_templates_category ON scenario_templates(category);
CREATE INDEX idx_scenario_timeline_scenario ON scenario_timeline_points(scenario_id);
CREATE INDEX idx_lab_tests_name ON lab_tests(test_name);
CREATE INDEX idx_lab_tests_group ON lab_tests(test_group);
CREATE INDEX idx_lab_tests_category ON lab_tests(category);
CREATE INDEX idx_lab_tests_code ON lab_tests(test_code);
CREATE INDEX idx_lab_panels_id ON lab_panels(panel_id);
CREATE INDEX idx_lab_panels_category ON lab_panels(category);
CREATE INDEX idx_panel_tests_panel ON panel_tests(panel_id);
CREATE INDEX idx_panel_tests_lab ON panel_tests(lab_test_id);
CREATE INDEX idx_investigation_templates_id ON investigation_templates(template_id);
CREATE INDEX idx_investigation_templates_type ON investigation_templates(investigation_type);
CREATE INDEX idx_medications_name ON medications(generic_name);
CREATE INDEX idx_medications_class ON medications(drug_class);
CREATE INDEX idx_medications_code ON medications(medication_code);
CREATE INDEX idx_search_aliases_term ON search_aliases(alias_term);
CREATE INDEX idx_search_aliases_type ON search_aliases(alias_type);
CREATE INDEX idx_diagnoses_icd ON diagnoses(icd_code);
CREATE INDEX idx_diagnoses_name ON diagnoses(name);
CREATE INDEX idx_diagnoses_system ON diagnoses(body_system);
CREATE INDEX idx_llm_usage_user_date ON llm_usage(user_id, date);
CREATE INDEX idx_llm_usage_date ON llm_usage(date);
CREATE INDEX idx_llm_request_log_user ON llm_request_log(user_id);
CREATE INDEX idx_llm_request_log_timestamp ON llm_request_log(request_timestamp);
CREATE INDEX idx_patient_record_events_session ON patient_record_events(session_id);
CREATE INDEX idx_patient_record_events_record ON patient_record_events(record_id);
CREATE INDEX idx_patient_record_events_verb ON patient_record_events(verb);
CREATE INDEX idx_patient_record_events_time ON patient_record_events(time_elapsed);
CREATE INDEX idx_patient_record_documents_session ON patient_record_documents(session_id);
CREATE INDEX idx_agent_templates_type ON agent_templates(agent_type);
CREATE INDEX idx_case_agents_case ON case_agents(case_id);
CREATE INDEX idx_agent_conv_session ON agent_conversations(session_id, agent_type);
CREATE INDEX idx_agent_state_session ON agent_session_state(session_id);
CREATE INDEX idx_team_log_session ON team_communications_log(session_id);
CREATE INDEX idx_treatment_orders_session ON treatment_orders(session_id);
CREATE INDEX idx_treatment_orders_status ON treatment_orders(status);
CREATE INDEX idx_treatment_orders_type ON treatment_orders(treatment_type);
CREATE INDEX idx_treatment_effects_type ON treatment_effects(treatment_type);
CREATE INDEX idx_treatment_effects_medication ON treatment_effects(medication_id);
CREATE INDEX idx_active_treatments_session ON active_treatments(session_id);
CREATE INDEX idx_active_treatments_order ON active_treatments(treatment_order_id);
CREATE INDEX idx_case_treatments_case ON case_treatments(case_id);
CREATE INDEX idx_case_treatments_type ON case_treatments(treatment_type);
CREATE INDEX idx_emotion_logs_session ON emotion_logs(session_id);
CREATE INDEX idx_emotion_logs_user ON emotion_logs(user_id);
CREATE INDEX idx_emotion_logs_timestamp ON emotion_logs(timestamp DESC);
CREATE INDEX idx_questionnaire_user ON questionnaire_responses(user_id);
CREATE INDEX idx_questionnaire_session ON questionnaire_responses(session_id);
CREATE UNIQUE INDEX idx_agent_templates_type_name
  ON agent_templates(agent_type, name);
CREATE INDEX idx_session_vitals_session
                ON session_vitals(session_id, timestamp);
CREATE INDEX idx_investigation_orders_investigation_id ON investigation_orders(investigation_id);
CREATE INDEX idx_settings_logs_session_id ON settings_logs(session_id);
CREATE INDEX idx_settings_logs_case_id ON settings_logs(case_id);
CREATE INDEX idx_session_settings_session_id ON session_settings(session_id);
CREATE INDEX idx_session_settings_user_id ON session_settings(user_id);
CREATE INDEX idx_session_settings_case_id ON session_settings(case_id);
CREATE INDEX idx_event_log_session_id ON event_log(session_id);
CREATE INDEX idx_event_log_user_id ON event_log(user_id);
CREATE INDEX idx_alarm_config_user_vital ON alarm_config(user_id, vital_sign);
CREATE INDEX idx_case_agents_template ON case_agents(agent_template_id);
CREATE INDEX idx_treatment_orders_medication ON treatment_orders(medication_id);
CREATE INDEX idx_case_treatments_medication ON case_treatments(medication_id);
CREATE INDEX idx_case_investigations_case_type ON case_investigations(case_id, investigation_type);
