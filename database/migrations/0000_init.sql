CREATE TYPE "public"."access_grant_reason" AS ENUM('REFERRAL', 'CARE_TEAM', 'DEPARTMENT_ORDER', 'ADMIN_GRANT', 'EMERGENCY_ACCESS');--> statement-breakpoint
CREATE TYPE "public"."admission_status" AS ENUM('ADMITTED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ai_summary_kind" AS ENUM('PATIENT_SUMMARY', 'TIMELINE_SUMMARY', 'LAB_SUMMARY', 'RADIOLOGY_SUMMARY', 'HANDOVER_SUMMARY', 'REFERRAL_BRIEF');--> statement-breakpoint
CREATE TYPE "public"."bed_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'CLEANING', 'RESERVED');--> statement-breakpoint
CREATE TYPE "public"."blood_group" AS ENUM('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."care_team_role" AS ENUM('ATTENDING', 'CONSULTING', 'SPECIALIST', 'RESIDENT', 'PRIMARY_NURSE', 'NURSE');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."encounter_type" AS ENUM('CONSULTATION', 'FOLLOW_UP', 'EMERGENCY', 'INPATIENT', 'SPECIALIST_CONSULTATION');--> statement-breakpoint
CREATE TYPE "public"."event_severity" AS ENUM('INFO', 'ATTENTION', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."investigation_category" AS ENUM('LAB', 'RADIOLOGY');--> statement-breakpoint
CREATE TYPE "public"."medication_route" AS ENUM('ORAL', 'IV', 'IM', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'SUBLINGUAL', 'RECTAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."medication_status" AS ENUM('PENDING', 'ACTIVE', 'STOPPED', 'COMPLETED', 'PENDING_DISPENSING', 'DISPENSED');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('XRAY', 'CT', 'MRI', 'ULTRASOUND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('ADMISSION', 'PROGRESS', 'CONSULTATION', 'NURSING', 'SPECIALIST', 'DISCHARGE');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_DECLINED', 'REFERRAL_INFORMATION_REQUESTED', 'REFERRAL_RESPONSE', 'REFERRAL_COMPLETED', 'CRITICAL_LAB_RESULT', 'LAB_RESULT_AVAILABLE', 'RADIOLOGY_REPORT_AVAILABLE', 'VITALS_RECORDED', 'MEDICATION_UPDATED', 'MEDICATION_DISPENSED', 'PATIENT_ADMITTED', 'PATIENT_TRANSFERRED', 'MESSAGE_RECEIVED', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."order_priority" AS ENUM('ROUTINE', 'URGENT', 'STAT');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('STABLE', 'NEEDS_ATTENTION', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."referral_priority" AS ENUM('ROUTINE', 'URGENT', 'EMERGENCY');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REQUESTED_INFORMATION', 'COMPLETED', 'DECLINED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."result_flag" AS ENUM('NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'SENIOR_DOCTOR', 'JUNIOR_DOCTOR', 'NURSE', 'RADIOLOGY', 'PATHOLOGY', 'PHARMACY', 'HR_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."study_status" AS ENUM('ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'REPORTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."timeline_event_type" AS ENUM('ADMISSION_CREATED', 'PATIENT_TRANSFERRED', 'PATIENT_DISCHARGED', 'ENCOUNTER_STARTED', 'CLINICAL_NOTE', 'VITALS_RECORDED', 'OBSERVATION_RECORDED', 'INVESTIGATION_ORDERED', 'LAB_RESULT', 'RADIOLOGY_REPORT', 'MEDICATION_ORDERED', 'MEDICATION_UPDATED', 'MEDICATION_ADMINISTERED', 'REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_DECLINED', 'REFERRAL_INFORMATION_REQUESTED', 'REFERRAL_RESPONSE', 'REFERRAL_COMPLETED', 'AI_SUMMARY', 'DOCUMENT_UPLOADED');--> statement-breakpoint
CREATE TABLE "admission_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_id" uuid NOT NULL,
	"from_ward_id" uuid,
	"from_bed_id" uuid,
	"to_ward_id" uuid,
	"to_bed_id" uuid,
	"reason" text,
	"performed_by_id" uuid NOT NULL,
	"transferred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_number" text NOT NULL,
	"admission_date" timestamp with time zone DEFAULT now() NOT NULL,
	"discharge_date" timestamp with time zone,
	"department_id" uuid NOT NULL,
	"ward_id" uuid,
	"bed_id" uuid,
	"attending_doctor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "admission_status" DEFAULT 'ADMITTED' NOT NULL,
	"discharge_summary" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "ai_summary_kind" NOT NULL,
	"content" text NOT NULL,
	"key_points" text[] DEFAULT '{}' NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"input_digest" text,
	"requested_by_id" uuid NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid,
	"referral_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"category" text NOT NULL,
	"storage_driver" text NOT NULL,
	"storage_path" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor_email" text,
	"actor_role" "role_name",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"patient_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"outcome" text DEFAULT 'SUCCESS' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ward_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "bed_status" DEFAULT 'AVAILABLE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"user_id" uuid NOT NULL,
	"role" "care_team_role" NOT NULL,
	"assigned_by_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clinical_note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"note_type" "note_type" NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid NOT NULL,
	"author_role" "role_name" NOT NULL,
	"department_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_retired" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"patient_id" uuid,
	"created_by_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_clinical" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_type" "encounter_type" NOT NULL,
	"department_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"reason" text,
	"start_time" timestamp with time zone DEFAULT now() NOT NULL,
	"end_time" timestamp with time zone,
	"status" "encounter_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_blobs" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"category" "investigation_category" NOT NULL,
	"panel" text NOT NULL,
	"clinical_info" text,
	"priority" "order_priority" DEFAULT 'ROUTINE' NOT NULL,
	"status" "order_status" DEFAULT 'ORDERED' NOT NULL,
	"department_id" uuid,
	"ordered_by_id" uuid NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"investigation_id" uuid,
	"analyte" text NOT NULL,
	"value" text NOT NULL,
	"numeric_value" double precision,
	"unit" text,
	"reference_range" text,
	"flag" "result_flag" DEFAULT 'NORMAL' NOT NULL,
	"comment" text,
	"resulted_by_id" uuid NOT NULL,
	"resulted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" "investigation_category" NOT NULL,
	"panel" text,
	"unit" text,
	"reference_low" double precision,
	"reference_high" double precision,
	"critical_low" double precision,
	"critical_high" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_administrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medication_order_id" uuid NOT NULL,
	"administered_by_id" uuid NOT NULL,
	"administered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dose_given" text NOT NULL,
	"was_withheld" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"medication_id" uuid,
	"medicine_name" text NOT NULL,
	"dose" text NOT NULL,
	"frequency" text NOT NULL,
	"route" "medication_route" NOT NULL,
	"instructions" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"prescriber_id" uuid NOT NULL,
	"status" "medication_status" DEFAULT 'PENDING' NOT NULL,
	"stop_reason" text,
	"dispensed_by_id" uuid,
	"dispensed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"generic_name" text,
	"form" text NOT NULL,
	"strength" text,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"patient_id" uuid,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"link" text,
	"severity" "event_severity" DEFAULT 'INFO' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"severity" "event_severity" DEFAULT 'INFO' NOT NULL,
	"recorded_by_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "access_grant_reason" NOT NULL,
	"justification" text,
	"reference_type" text,
	"reference_id" uuid,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "patient_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" "gender" NOT NULL,
	"blood_group" "blood_group" DEFAULT 'UNKNOWN' NOT NULL,
	"phone" text,
	"email" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"allergies" text[] DEFAULT '{}' NOT NULL,
	"chronic_conditions" text[] DEFAULT '{}' NOT NULL,
	"status" "patient_status" DEFAULT 'STABLE' NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"findings" text NOT NULL,
	"impression" text NOT NULL,
	"recommendation" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"radiologist_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radiology_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession_number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"order_id" uuid,
	"modality" "modality" NOT NULL,
	"body_part" text NOT NULL,
	"description" text NOT NULL,
	"clinical_info" text,
	"contrast_used" boolean DEFAULT false NOT NULL,
	"priority" "order_priority" DEFAULT 'ROUTINE' NOT NULL,
	"status" "study_status" DEFAULT 'ORDERED' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"performed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"assessment" text NOT NULL,
	"findings" text NOT NULL,
	"recommendations" text NOT NULL,
	"treatment_plan" text NOT NULL,
	"follow_up" text,
	"author_id" uuid NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"referring_doctor_id" uuid NOT NULL,
	"specialist_doctor_id" uuid NOT NULL,
	"from_department_id" uuid NOT NULL,
	"to_department_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"clinical_summary" text NOT NULL,
	"symptoms" text,
	"relevant_history" text,
	"relevant_investigations" text,
	"current_medications" text,
	"priority" "referral_priority" DEFAULT 'ROUTINE' NOT NULL,
	"status" "referral_status" DEFAULT 'PENDING' NOT NULL,
	"information_request" text,
	"information_response" text,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "role_name" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"staff_number" text NOT NULL,
	"department_id" uuid,
	"designation" text NOT NULL,
	"specialization" text,
	"registration_number" text,
	"phone" text,
	"accepts_referrals" boolean DEFAULT false NOT NULL,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"event_type" timeline_event_type NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"actor_id" uuid,
	"department_id" uuid,
	"reference_type" text,
	"reference_id" uuid,
	"severity" "event_severity" DEFAULT 'INFO' NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" uuid,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"primary_role" "role_name" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_reset" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vital_signs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"encounter_id" uuid,
	"temperature_c" double precision,
	"heart_rate" integer,
	"blood_pressure_systolic" integer,
	"blood_pressure_diastolic" integer,
	"spo2" integer,
	"respiratory_rate" integer,
	"pain_score" integer,
	"blood_glucose" double precision,
	"news_score" integer,
	"is_abnormal" boolean DEFAULT false NOT NULL,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"floor" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_from_ward_id_wards_id_fk" FOREIGN KEY ("from_ward_id") REFERENCES "public"."wards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_from_bed_id_beds_id_fk" FOREIGN KEY ("from_bed_id") REFERENCES "public"."beds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_to_ward_id_wards_id_fk" FOREIGN KEY ("to_ward_id") REFERENCES "public"."wards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_to_bed_id_beds_id_fk" FOREIGN KEY ("to_bed_id") REFERENCES "public"."beds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_transfers" ADD CONSTRAINT "admission_transfers_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."beds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_attending_doctor_id_users_id_fk" FOREIGN KEY ("attending_doctor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_summaries" ADD CONSTRAINT "ai_summaries_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_members" ADD CONSTRAINT "care_team_members_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_members" ADD CONSTRAINT "care_team_members_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_members" ADD CONSTRAINT "care_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_team_members" ADD CONSTRAINT "care_team_members_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_note_id_clinical_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_provider_id_users_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_orders" ADD CONSTRAINT "investigation_orders_ordered_by_id_users_id_fk" FOREIGN KEY ("ordered_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_order_id_investigation_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."investigation_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_results" ADD CONSTRAINT "investigation_results_resulted_by_id_users_id_fk" FOREIGN KEY ("resulted_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_medication_order_id_medication_orders_id_fk" FOREIGN KEY ("medication_order_id") REFERENCES "public"."medication_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_administered_by_id_users_id_fk" FOREIGN KEY ("administered_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_prescriber_id_users_id_fk" FOREIGN KEY ("prescriber_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_dispensed_by_id_users_id_fk" FOREIGN KEY ("dispensed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_access_grants" ADD CONSTRAINT "patient_access_grants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_reports" ADD CONSTRAINT "radiology_reports_study_id_radiology_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."radiology_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_reports" ADD CONSTRAINT "radiology_reports_radiologist_id_users_id_fk" FOREIGN KEY ("radiologist_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_order_id_investigation_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."investigation_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_responses" ADD CONSTRAINT "referral_responses_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_responses" ADD CONSTRAINT "referral_responses_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referring_doctor_id_users_id_fk" FOREIGN KEY ("referring_doctor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_specialist_doctor_id_users_id_fk" FOREIGN KEY ("specialist_doctor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_admission_id_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_transfers_admission_idx" ON "admission_transfers" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_number_key" ON "admissions" USING btree ("admission_number");--> statement-breakpoint
CREATE INDEX "admissions_patient_idx" ON "admissions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "admissions_status_idx" ON "admissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admissions_attending_idx" ON "admissions" USING btree ("attending_doctor_id");--> statement-breakpoint
CREATE INDEX "admissions_department_idx" ON "admissions" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "ai_summaries_patient_idx" ON "ai_summaries" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_patient_idx" ON "attachments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "audit_logs_patient_idx" ON "audit_logs" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "beds_ward_code_key" ON "beds" USING btree ("ward_id","code");--> statement-breakpoint
CREATE INDEX "beds_status_idx" ON "beds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "care_team_patient_idx" ON "care_team_members" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "care_team_user_idx" ON "care_team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_note_versions_key" ON "clinical_note_versions" USING btree ("note_id","version");--> statement-breakpoint
CREATE INDEX "clinical_notes_patient_idx" ON "clinical_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_notes_type_idx" ON "clinical_notes" USING btree ("note_type");--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_patient_idx" ON "conversations" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_key" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "encounters_provider_idx" ON "encounters" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "encounters_admission_idx" ON "encounters" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_orders_number_key" ON "investigation_orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "investigation_orders_patient_idx" ON "investigation_orders" USING btree ("patient_id","ordered_at");--> statement-breakpoint
CREATE INDEX "investigation_orders_status_idx" ON "investigation_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investigation_orders_category_idx" ON "investigation_orders" USING btree ("category");--> statement-breakpoint
CREATE INDEX "investigation_results_patient_idx" ON "investigation_results" USING btree ("patient_id","resulted_at");--> statement-breakpoint
CREATE INDEX "investigation_results_order_idx" ON "investigation_results" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "investigation_results_flag_idx" ON "investigation_results" USING btree ("flag");--> statement-breakpoint
CREATE UNIQUE INDEX "investigations_code_key" ON "investigations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "investigations_category_idx" ON "investigations" USING btree ("category");--> statement-breakpoint
CREATE INDEX "investigations_panel_idx" ON "investigations" USING btree ("panel");--> statement-breakpoint
CREATE INDEX "medication_administrations_order_idx" ON "medication_administrations" USING btree ("medication_order_id");--> statement-breakpoint
CREATE INDEX "medication_orders_patient_idx" ON "medication_orders" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "medication_orders_status_idx" ON "medication_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "medications_code_key" ON "medications" USING btree ("code");--> statement-breakpoint
CREATE INDEX "medications_name_idx" ON "medications" USING btree ("name");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","read","created_at");--> statement-breakpoint
CREATE INDEX "observations_patient_idx" ON "observations" USING btree ("patient_id","recorded_at");--> statement-breakpoint
CREATE INDEX "patient_access_grants_patient_user_idx" ON "patient_access_grants" USING btree ("patient_id","user_id");--> statement-breakpoint
CREATE INDEX "patient_access_grants_user_idx" ON "patient_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "patient_contacts_patient_idx" ON "patient_contacts" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_patient_number_key" ON "patients" USING btree ("patient_number");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "patients_status_idx" ON "patients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "permissions_category_idx" ON "permissions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "radiology_reports_study_idx" ON "radiology_reports" USING btree ("study_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radiology_studies_accession_key" ON "radiology_studies" USING btree ("accession_number");--> statement-breakpoint
CREATE INDEX "radiology_studies_patient_idx" ON "radiology_studies" USING btree ("patient_id","requested_at");--> statement-breakpoint
CREATE INDEX "radiology_studies_status_idx" ON "radiology_studies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "referral_responses_referral_idx" ON "referral_responses" USING btree ("referral_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_number_key" ON "referrals" USING btree ("referral_number");--> statement-breakpoint
CREATE INDEX "referrals_specialist_status_idx" ON "referrals" USING btree ("specialist_doctor_id","status");--> statement-breakpoint
CREATE INDEX "referrals_referring_status_idx" ON "referrals" USING btree ("referring_doctor_id","status");--> statement-breakpoint
CREATE INDEX "referrals_patient_idx" ON "referrals" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_key" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_id_key" ON "sessions" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_staff_number_key" ON "staff_profiles" USING btree ("staff_number");--> statement-breakpoint
CREATE INDEX "staff_profiles_department_idx" ON "staff_profiles" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "staff_profiles_accepts_referrals_idx" ON "staff_profiles" USING btree ("accepts_referrals");--> statement-breakpoint
CREATE INDEX "timeline_events_patient_idx" ON "timeline_events" USING btree ("patient_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_type_idx" ON "timeline_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_primary_role_idx" ON "users" USING btree ("primary_role");--> statement-breakpoint
CREATE INDEX "users_is_active_idx" ON "users" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "vital_signs_patient_idx" ON "vital_signs" USING btree ("patient_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wards_code_key" ON "wards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "wards_department_idx" ON "wards" USING btree ("department_id");