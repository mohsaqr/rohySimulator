# Learning Analytics

The browser `EventLogger` emits xAPI-style telemetry through
`NotificationCenter` and `BackendSurface`. BackendSurface batches telemetry
to `POST /api/learning-events/batch`, where it deserialises into
`learning_events`.

## Storage Mapping

Each notification becomes one `learning_events` row:

| Payload | Column |
|---|---|
| `timestamp` | `timestamp` |
| `session_id`, `user_id`, `case_id` | same-named columns |
| `data.verb` | `verb` |
| `data.objectType` | `object_type` |
| `data.objectId`, `data.objectName` | `object_id`, `object_name` |
| `data.component`, `data.parentComponent` | `component`, `parent_component` |
| `data.result`, `data.durationMs`, `data.context` | `result`, `duration_ms`, `context` |
| `data.messageContent`, `data.messageRole` | `message_content`, `message_role` |
| notification severity/category | `severity`, `category` |

`context` is JSON-stringified. Message content is intentionally separated so
chat-specific reports can filter it. Tenant scope is taken from the
authenticated user on the server, not from the browser payload.

## Consumers

The same table feeds:

| Consumer | Use |
|---|---|
| TNA dashboard | Sequence mining, timelines, daily/hourly counts, top resources, verb/object frequencies. |
| Session log viewer | Session-scoped event replay. |
| User analytics/export | User-scoped activity history and CSV/export routes. |
| DiagnosticBar backend counters | Detects failed telemetry persistence before rows reach the DB. |

## Verb Catalogue

| Verb | Meaning | Primary consumer |
|---|---|---|
| `STARTED_SESSION` | Learner started a case session. | TNA, session log viewer |
| `ENDED_SESSION` | Learner ended a case session. | TNA, session log viewer |
| `RESUMED_SESSION` | Browser restored a prior session. | Session log viewer |
| `IDLE_TIMEOUT` | Session idle timeout occurred. | Session log viewer |
| `UNLOAD` | Browser window is unloading. | Session log viewer |
| `VIEWED` | Generic view event. | TNA |
| `OPENED` | Component/modal/panel opened. | TNA, session log viewer |
| `CLOSED` | Component/modal/panel closed. | TNA, session log viewer |
| `NAVIGATED` | Navigation occurred. | TNA |
| `SWITCHED_TAB` | User changed tabs/views. | TNA |
| `SCROLLED` | User scrolled a tracked surface. | Session log viewer |
| `LOST_FOCUS` | Browser window lost focus. | Session log viewer |
| `RESUMED_FOCUS` | Browser window regained focus. | Session log viewer |
| `CLICKED` | Button/control clicked. | TNA |
| `SELECTED` | Item selected. | TNA |
| `DESELECTED` | Item deselected. | TNA |
| `TOGGLED` | Toggle changed. | TNA |
| `EXPANDED` | Group/section expanded. | Session log viewer |
| `COLLAPSED` | Group/section collapsed. | Session log viewer |
| `ORDERED_LAB` | Lab ordered. | TNA, session log viewer |
| `CANCELLED_LAB` | Lab order cancelled. | Session log viewer |
| `VIEWED_LAB_RESULT` | Lab result viewed. | TNA, session log viewer |
| `SEARCHED_LABS` | Lab catalogue searched. | Session log viewer |
| `FILTERED_LABS` | Lab catalogue filtered. | Session log viewer |
| `LAB_RESULT_READY` | Lab result became available. | Session log viewer |
| `ORDERED_MEDICATION` | Medication ordered. | TNA, session log viewer |
| `ADMINISTERED_MEDICATION` | Medication administered. | TNA, session log viewer |
| `CANCELLED_MEDICATION` | Medication order cancelled. | Session log viewer |
| `ORDERED_TREATMENT` | Treatment ordered. | TNA, session log viewer |
| `PERFORMED_INTERVENTION` | Intervention performed. | TNA, session log viewer |
| `ORDERED_IV_FLUID` | IV fluid ordered. | TNA, session log viewer |
| `STARTED_OXYGEN` | Oxygen therapy started. | TNA, session log viewer |
| `STOPPED_OXYGEN` | Oxygen therapy stopped. | Session log viewer |
| `ORDERED_NURSING` | Nursing order placed. | Session log viewer |
| `DISCONTINUED_TREATMENT` | Treatment discontinued. | TNA, session log viewer |
| `TREATMENT_EFFECT_STARTED` | Simulated treatment effect started. | Session log viewer |
| `TREATMENT_EFFECT_PEAKED` | Simulated treatment effect peaked. | Session log viewer |
| `TREATMENT_EFFECT_ENDED` | Simulated treatment effect ended. | Session log viewer |
| `CONTRAINDICATED_TREATMENT_ORDERED` | Unsafe/contraindicated treatment attempted. | TNA, assessment reports |
| `EXPECTED_TREATMENT_GIVEN` | Expected treatment was given. | TNA, assessment reports |
| `EXPECTED_TREATMENT_MISSED` | Expected treatment was missed. | TNA, assessment reports |
| `PERFORMED_PHYSICAL_EXAM` | Physical exam action performed. | TNA, session log viewer |
| `OPENED_EXAM_PANEL` | Examination panel opened. | Session log viewer |
| `CLOSED_EXAM_PANEL` | Examination panel closed. | Session log viewer |
| `SENT_MESSAGE` | Learner sent a chat message. | TNA, session log viewer |
| `RECEIVED_MESSAGE` | Simulated patient/agent replied. | TNA, session log viewer |
| `COPIED_MESSAGE` | Chat message copied. | Session log viewer |
| `EDITED_MESSAGE` | Chat message edited. | Session log viewer |
| `STT_RESULT` | Speech recognition produced transcript metadata. Transcript text is not logged in context. | Session log viewer |
| `STT_ERROR` | Speech recognition returned an error. | Session log viewer, diagnostics |
| `TTS_PLAYED` | TTS audio finished playback. | Session log viewer, diagnostics |
| `ADJUSTED_VITAL` | Vital sign adjusted. | TNA, session log viewer |
| `ACKNOWLEDGED_ALARM` | Alarm acknowledged. | Session log viewer |
| `SILENCED_ALARM` | Alarm silenced. | Session log viewer |
| `ALARM_TRIGGERED` | Clinical alarm fired. | Session log viewer |
| `VIEWED_TRENDS` | Vital trends viewed. | Session log viewer |
| `VIEWED_PATIENT_SUMMARY` | Patient summary viewed. | Session log viewer |
| `VIEWED_HISTORY` | Patient history viewed. | Session log viewer |
| `VIEWED_MEDICATIONS` | Medication history viewed. | Session log viewer |
| `VIEWED_ALLERGIES` | Allergy list viewed. | Session log viewer |
| `CHANGED_SETTING` | Setting changed. | Admin/settings reports |
| `SAVED_SETTING` | Setting saved. | Admin/settings reports |
| `RESET_SETTING` | Setting reset. | Admin/settings reports |
| `LOADED_CASE` | Case loaded into the app. | TNA, session log viewer |
| `VIEWED_PATIENT_INFO` | Patient information viewed. | Session log viewer |
| `VIEWED_RECORDS` | Patient records viewed. | Session log viewer |
| `SAVED_CASE` | Case definition saved. | Admin/settings reports |
| `EXPORTED_CASE` | Case exported. | Admin/export reports |
| `STARTED_SCENARIO` | Scenario engine started. | TNA, session log viewer |
| `PAUSED_SCENARIO` | Scenario paused. | Session log viewer |
| `RESUMED_SCENARIO` | Scenario resumed. | Session log viewer |
| `COMPLETED_SCENARIO` | Scenario completed. | TNA, assessment reports |
| `RESET_SCENARIO` | Scenario reset. | Session log viewer |
| `SUBMITTED` | Learner submitted an answer/form. | TNA, assessment reports |
| `ANSWERED` | Learner answered a prompt. | TNA, assessment reports |
| `ATTEMPTED` | Learner attempted an assessment item. | TNA, assessment reports |
| `CORRECT_ANSWER` | Answer was correct. | Assessment reports |
| `INCORRECT_ANSWER` | Answer was incorrect. | Assessment reports |
| `EXPRESSED_EMOTION` | Patient/agent emotion expression logged. | Session log viewer |
| `ERROR_OCCURRED` | Component/system error occurred. | Diagnostics |
| `API_ERROR` | API call failed. | Diagnostics |
| `VALIDATION_ERROR` | Validation failed. | Diagnostics |

## xAPI Style

The platform uses xAPI-like triples without implementing a full LRS:

```text
actor: authenticated user
verb: EventLogger VERBS value
object: object_type + object_id/object_name
context: session_id, case_id, component, parent_component, context JSON
result: result, duration_ms, message fields
```

This shape is deliberately stable so sequence analytics can group by verb and
object type without parsing UI-specific payloads.
