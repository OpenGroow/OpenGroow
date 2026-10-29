/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_hmac from "../agent_hmac.js";
import type * as auth from "../auth.js";
import type * as auth_config from "../auth_config.js";
import type * as auth_node from "../auth_node.js";
import type * as auth_registration_lock from "../auth_registration_lock.js";
import type * as auth_registration_policy from "../auth_registration_policy.js";
import type * as brand_cores from "../brand_cores.js";
import type * as command_batching from "../command_batching.js";
import type * as command_dispatch_utils from "../command_dispatch_utils.js";
import type * as commands from "../commands.js";
import type * as commands_batch_node from "../commands_batch_node.js";
import type * as commands_node from "../commands_node.js";
import type * as connect_tickets from "../connect_tickets.js";
import type * as connect_tickets_command from "../connect_tickets_command.js";
import type * as connect_tickets_node from "../connect_tickets_node.js";
import type * as connect_tickets_utils from "../connect_tickets_utils.js";
import type * as connected_devices from "../connected_devices.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as error_message from "../error_message.js";
import type * as events from "../events.js";
import type * as events_node from "../events_node.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as indexing from "../indexing.js";
import type * as instance_ownership from "../instance_ownership.js";
import type * as instance_provisioning_control_plane from "../instance_provisioning/control_plane.js";
import type * as instance_provisioning_index from "../instance_provisioning/index.js";
import type * as instance_provisioning_local from "../instance_provisioning/local.js";
import type * as instance_provisioning_types from "../instance_provisioning/types.js";
import type * as instances from "../instances.js";
import type * as instances_node from "../instances_node.js";
import type * as jobs from "../jobs.js";
import type * as local_folder_gate from "../local_folder_gate.js";
import type * as mcp_activation_url from "../mcp_activation_url.js";
import type * as mcp_endpoint from "../mcp_endpoint.js";
import type * as mcp_node from "../mcp_node.js";
import type * as mcp_url_override from "../mcp_url_override.js";
import type * as migrations from "../migrations.js";
import type * as mission_dispatcher from "../mission_dispatcher.js";
import type * as mission_dispatcher_blocker_codes from "../mission_dispatcher/blocker_codes.js";
import type * as mission_dispatcher_compose_agents_md from "../mission_dispatcher/compose_agents_md.js";
import type * as mission_dispatcher_context_providers from "../mission_dispatcher/context_providers.js";
import type * as mission_dispatcher_decision_log from "../mission_dispatcher/decision_log.js";
import type * as mission_dispatcher_enqueue_command from "../mission_dispatcher/enqueue_command.js";
import type * as mission_dispatcher_error_message from "../mission_dispatcher/error_message.js";
import type * as mission_dispatcher_external_job_poll_node from "../mission_dispatcher/external_job_poll_node.js";
import type * as mission_dispatcher_external_job_polling from "../mission_dispatcher/external_job_polling.js";
import type * as mission_dispatcher_mission_context from "../mission_dispatcher/mission_context.js";
import type * as mission_dispatcher_reconcile_apply_node from "../mission_dispatcher/reconcile_apply_node.js";
import type * as mission_dispatcher_reconciliation from "../mission_dispatcher/reconciliation.js";
import type * as mission_dispatcher_session_budget from "../mission_dispatcher/session_budget.js";
import type * as mission_dispatcher_node from "../mission_dispatcher_node.js";
import type * as mission_review from "../mission_review.js";
import type * as mission_summary_http from "../mission_summary_http.js";
import type * as missions from "../missions.js";
import type * as missions_node from "../missions_node.js";
import type * as observations_carousel_delegation from "../observations_carousel_delegation.js";
import type * as observations_ranking from "../observations_ranking.js";
import type * as observations_scoring_daily from "../observations_scoring_daily.js";
import type * as openclaw_usage from "../openclaw_usage.js";
import type * as optional_plugins from "../optional_plugins.js";
import type * as project_agents from "../project_agents.js";
import type * as project_agents_activation_helpers from "../project_agents/activation_helpers.js";
import type * as project_agents_auth from "../project_agents/auth.js";
import type * as project_agents_mcp_servers from "../project_agents/mcp_servers.js";
import type * as project_agents_runtime_calls from "../project_agents/runtime_calls.js";
import type * as project_agents_shared_refs from "../project_agents/shared_refs.js";
import type * as project_agents_status_check from "../project_agents/status_check.js";
import type * as project_agents_template_plugins from "../project_agents/template_plugins.js";
import type * as project_agents_template_workspace_files from "../project_agents/template_workspace_files.js";
import type * as project_agents_workspace_compound_commands from "../project_agents/workspace_compound_commands.js";
import type * as project_agents_workspace_provisioning from "../project_agents/workspace_provisioning.js";
import type * as project_agents_node from "../project_agents_node.js";
import type * as project_channel_operations from "../project_channel_operations.js";
import type * as project_node_operations from "../project_node_operations.js";
import type * as project_overview from "../project_overview.js";
import type * as project_provider_operations from "../project_provider_operations.js";
import type * as project_templates from "../project_templates.js";
import type * as project_templates_node from "../project_templates_node.js";
import type * as projects from "../projects.js";
import type * as run_parent from "../run_parent.js";
import type * as run_result from "../run_result.js";
import type * as runs from "../runs.js";
import type * as runtime_commands_node from "../runtime_commands_node.js";
import type * as runtime_commands_node_parsers from "../runtime_commands_node_parsers.js";
import type * as schedules from "../schedules.js";
import type * as schedules_frequency from "../schedules/frequency.js";
import type * as score_jobs from "../score_jobs.js";
import type * as source_agent from "../source_agent.js";
import type * as source_bootstrap from "../source_bootstrap.js";
import type * as source_bootstrap_node from "../source_bootstrap_node.js";
import type * as source_enrichment from "../source_enrichment.js";
import type * as source_jobs from "../source_jobs.js";
import type * as source_jobs_enrichment_poll_node from "../source_jobs/enrichment_poll_node.js";
import type * as source_jobs_ingest_sources from "../source_jobs/ingest_sources.js";
import type * as source_jobs_job_files from "../source_jobs/job_files.js";
import type * as source_jobs_limits from "../source_jobs/limits.js";
import type * as source_jobs_retry_feedback from "../source_jobs/retry_feedback.js";
import type * as source_jobs_source_job_context from "../source_jobs/source_job_context.js";
import type * as source_jobs_source_run_result from "../source_jobs/source_run_result.js";
import type * as source_routing from "../source_routing.js";
import type * as source_schema from "../source_schema.js";
import type * as source_scoring from "../source_scoring.js";
import type * as sources from "../sources.js";
import type * as sources_social from "../sources_social.js";
import type * as template_install_local from "../template_install_local.js";
import type * as template_manifest_contract from "../template_manifest_contract.js";
import type * as template_mcp_overrides from "../template_mcp_overrides.js";
import type * as template_registry from "../template_registry.js";
import type * as template_registry_store from "../template_registry_store.js";
import type * as test_helpers_observation_source from "../test/helpers/observation_source.js";
import type * as test_instance_fixture from "../test/instance_fixture.js";
import type * as validators from "../validators.js";
import type * as workspace_logs from "../workspace_logs.js";
import type * as workspace_logs_node from "../workspace_logs_node.js";
import type * as workspace_operations_node from "../workspace_operations_node.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent_hmac: typeof agent_hmac;
  auth: typeof auth;
  auth_config: typeof auth_config;
  auth_node: typeof auth_node;
  auth_registration_lock: typeof auth_registration_lock;
  auth_registration_policy: typeof auth_registration_policy;
  brand_cores: typeof brand_cores;
  command_batching: typeof command_batching;
  command_dispatch_utils: typeof command_dispatch_utils;
  commands: typeof commands;
  commands_batch_node: typeof commands_batch_node;
  commands_node: typeof commands_node;
  connect_tickets: typeof connect_tickets;
  connect_tickets_command: typeof connect_tickets_command;
  connect_tickets_node: typeof connect_tickets_node;
  connect_tickets_utils: typeof connect_tickets_utils;
  connected_devices: typeof connected_devices;
  crons: typeof crons;
  env: typeof env;
  error_message: typeof error_message;
  events: typeof events;
  events_node: typeof events_node;
  health: typeof health;
  http: typeof http;
  indexing: typeof indexing;
  instance_ownership: typeof instance_ownership;
  "instance_provisioning/control_plane": typeof instance_provisioning_control_plane;
  "instance_provisioning/index": typeof instance_provisioning_index;
  "instance_provisioning/local": typeof instance_provisioning_local;
  "instance_provisioning/types": typeof instance_provisioning_types;
  instances: typeof instances;
  instances_node: typeof instances_node;
  jobs: typeof jobs;
  local_folder_gate: typeof local_folder_gate;
  mcp_activation_url: typeof mcp_activation_url;
  mcp_endpoint: typeof mcp_endpoint;
  mcp_node: typeof mcp_node;
  mcp_url_override: typeof mcp_url_override;
  migrations: typeof migrations;
  mission_dispatcher: typeof mission_dispatcher;
  "mission_dispatcher/blocker_codes": typeof mission_dispatcher_blocker_codes;
  "mission_dispatcher/compose_agents_md": typeof mission_dispatcher_compose_agents_md;
  "mission_dispatcher/context_providers": typeof mission_dispatcher_context_providers;
  "mission_dispatcher/decision_log": typeof mission_dispatcher_decision_log;
  "mission_dispatcher/enqueue_command": typeof mission_dispatcher_enqueue_command;
  "mission_dispatcher/error_message": typeof mission_dispatcher_error_message;
  "mission_dispatcher/external_job_poll_node": typeof mission_dispatcher_external_job_poll_node;
  "mission_dispatcher/external_job_polling": typeof mission_dispatcher_external_job_polling;
  "mission_dispatcher/mission_context": typeof mission_dispatcher_mission_context;
  "mission_dispatcher/reconcile_apply_node": typeof mission_dispatcher_reconcile_apply_node;
  "mission_dispatcher/reconciliation": typeof mission_dispatcher_reconciliation;
  "mission_dispatcher/session_budget": typeof mission_dispatcher_session_budget;
  mission_dispatcher_node: typeof mission_dispatcher_node;
  mission_review: typeof mission_review;
  mission_summary_http: typeof mission_summary_http;
  missions: typeof missions;
  missions_node: typeof missions_node;
  observations_carousel_delegation: typeof observations_carousel_delegation;
  observations_ranking: typeof observations_ranking;
  observations_scoring_daily: typeof observations_scoring_daily;
  openclaw_usage: typeof openclaw_usage;
  optional_plugins: typeof optional_plugins;
  project_agents: typeof project_agents;
  "project_agents/activation_helpers": typeof project_agents_activation_helpers;
  "project_agents/auth": typeof project_agents_auth;
  "project_agents/mcp_servers": typeof project_agents_mcp_servers;
  "project_agents/runtime_calls": typeof project_agents_runtime_calls;
  "project_agents/shared_refs": typeof project_agents_shared_refs;
  "project_agents/status_check": typeof project_agents_status_check;
  "project_agents/template_plugins": typeof project_agents_template_plugins;
  "project_agents/template_workspace_files": typeof project_agents_template_workspace_files;
  "project_agents/workspace_compound_commands": typeof project_agents_workspace_compound_commands;
  "project_agents/workspace_provisioning": typeof project_agents_workspace_provisioning;
  project_agents_node: typeof project_agents_node;
  project_channel_operations: typeof project_channel_operations;
  project_node_operations: typeof project_node_operations;
  project_overview: typeof project_overview;
  project_provider_operations: typeof project_provider_operations;
  project_templates: typeof project_templates;
  project_templates_node: typeof project_templates_node;
  projects: typeof projects;
  run_parent: typeof run_parent;
  run_result: typeof run_result;
  runs: typeof runs;
  runtime_commands_node: typeof runtime_commands_node;
  runtime_commands_node_parsers: typeof runtime_commands_node_parsers;
  schedules: typeof schedules;
  "schedules/frequency": typeof schedules_frequency;
  score_jobs: typeof score_jobs;
  source_agent: typeof source_agent;
  source_bootstrap: typeof source_bootstrap;
  source_bootstrap_node: typeof source_bootstrap_node;
  source_enrichment: typeof source_enrichment;
  source_jobs: typeof source_jobs;
  "source_jobs/enrichment_poll_node": typeof source_jobs_enrichment_poll_node;
  "source_jobs/ingest_sources": typeof source_jobs_ingest_sources;
  "source_jobs/job_files": typeof source_jobs_job_files;
  "source_jobs/limits": typeof source_jobs_limits;
  "source_jobs/retry_feedback": typeof source_jobs_retry_feedback;
  "source_jobs/source_job_context": typeof source_jobs_source_job_context;
  "source_jobs/source_run_result": typeof source_jobs_source_run_result;
  source_routing: typeof source_routing;
  source_schema: typeof source_schema;
  source_scoring: typeof source_scoring;
  sources: typeof sources;
  sources_social: typeof sources_social;
  template_install_local: typeof template_install_local;
  template_manifest_contract: typeof template_manifest_contract;
  template_mcp_overrides: typeof template_mcp_overrides;
  template_registry: typeof template_registry;
  template_registry_store: typeof template_registry_store;
  "test/helpers/observation_source": typeof test_helpers_observation_source;
  "test/instance_fixture": typeof test_instance_fixture;
  validators: typeof validators;
  workspace_logs: typeof workspace_logs;
  workspace_logs_node: typeof workspace_logs_node;
  workspace_operations_node: typeof workspace_operations_node;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
