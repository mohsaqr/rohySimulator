# Users, courses and management

Rohy's management layer is what turns a simulation engine into a teaching platform. It defines who the learners are, who can teach, who can administer, which courses exist, which students belong to them, which cases are assigned, what students can access and how activity becomes interpretable at class level. Without this layer, Rohy would still run cases, but it would not reliably support institutional teaching.

Management is also part of the research apparatus. A learning trace is only meaningful when the learner identity, course membership, assignment context and access rules are known. A transition network from an undefined population is weak evidence. A completion grid without enrollment context is only a table. Rohy therefore treats users, roles, tenants, courses and access policy as core product capabilities.

## Identity and roles

Every meaningful action in Rohy is tied to a user. The user record anchors sessions, learning events, class membership, exports, audit logs and administrative actions. Administrators can create users individually, import them in batches, edit roles, delete accounts, purge or anonymise data where appropriate and force logout active sessions when needed.

Roles are rank-based rather than string-based. A student can run cases. A reviewer can inspect more information. An educator, displayed as Teacher in the UI, can author cases and manage classes. An admin can administer the platform. Rank comparison allows permissions to evolve without brittle equality checks, and it prevents a lower-ranked user from granting a role higher than their own.

This role model is operationally useful because it supports delegation. Teachers can run courses without being platform administrators. Administrators can manage identity and governance without authoring every case. Students receive the narrowest access needed for their learning task.

## Tenants as institutional boundaries

A tenant is the organisational boundary inside a deployment. Users, sessions, courses, catalogue rows and logs are tenant-scoped. Tenant isolation is enforced through middleware, not by hoping every route remembers to add the correct filter. This matters because cross-tenant leakage would damage both privacy and research validity.

In a single-tenant deployment, this boundary is still active. In a multi-tenant deployment, it becomes the line between organisations. An admin is tenant-local. A teacher sees classes in their own tenant. Active sessions and logs are scoped. Catalogue rows may be user, tenant or platform scoped depending on governance. Moving a user between tenants does not automatically move content they authored, which is why tenant reassignment must be treated as an administrative operation rather than a casual edit.

## Courses, classes and enrollment

In the UI, the teacher works with classes. In the API and some internal references, the same concept is called a cohort. A class is the teaching unit: it has an owner, may have co-teachers, contains students, can carry dates and course metadata, can generate a join code, can hold assigned cases and becomes the scope for roster, completion, analytics, feed and export.

Enrollment can happen in several ways. A teacher can add one student by username or email. A teacher can add students in bulk. A teacher can add co-teachers. Students can self-enrol with a join code. Re-adding a removed member revives the membership rather than creating duplicate history. Co-teacher promotion is handled carefully so a user is not accidentally duplicated or demoted.

Join codes lower operational friction. A code lets students attach themselves to the correct class after authentication. Codes can be copied, rotated or disabled. Because anyone with the code can join, they are convenient but not secret credentials. If a code leaks, the teacher should rotate or disable it.

## Assignment and access

Case assignment links a case to a class. It does not copy the case and it does not freeze the case. A session snapshot is created only when a learner starts a run. Assignment defines curricular intent: these are the cases this class should work on.

The current student access model follows that intent. Students see the default case in the default course and the live cases assigned through their active class memberships. Unassigned live cases are not exposed as ordinary student-startable cases, and direct unassigned access is blocked at the runtime and API boundary. This protects course design. Students should not browse the entire case library when a teacher has assigned a specific learning sequence.

Assignment remains separate from scoring. Reports reflect sessions students actually ran. Unassigning a case removes the live class link but does not delete the case or erase historical sessions. This separation allows teachers to change course structure without corrupting the record of what already happened.

## Reporting as management

Roster, completion grid, live feed and export are management analytics. The roster shows who is enrolled and what activity exists for each student. The completion grid shows which students attempted or completed which cases. The live feed shows current class activity. Export moves the course record into external grading, LMS or research workflows.

These views are intentionally practical. They help a teacher run a class, identify non-participation, prepare debrief and document progress. They are not replacements for deeper analytics, but they provide the operational frame that deeper analytics require. Before interpreting a transition network or Oyon pattern, a teacher needs to know who was assigned, who attempted, who completed and when activity occurred.

Exports are governance events. Once data leaves Rohy, it enters another institutional context. Rohy therefore records export history, applies authentication and scope checks, neutralises spreadsheet-formula risks and relies on central redaction policies where sensitive fields may appear.

## Policy metadata and current limits

Classes can store policy metadata such as passing score, retake intent, debrief requirement, course code, term and learning objectives. These fields document teaching intent and prepare the platform for future enforcement, but they should not be mistaken for fully enforced runtime gates unless the relevant feature explicitly implements enforcement.

This distinction is important. Completion currently means reaching debrief. A stored passing threshold does not automatically grade a learner. A stored retake policy does not necessarily block another attempt. Rohy should be read honestly: it records policy intent now and may enforce more of it later, but teachers must communicate assessment rules directly until enforcement exists.

## Governance and scientific value

The management layer protects trust. Role checks prevent over-granting. Tenant boundaries protect organisations. Join-code rotation protects enrollment. Student access policy protects curricular design. Soft deletion and purge workflows support lifecycle governance. Audit logs and export records support accountability.

For research, the same layer protects interpretation. It tells the researcher which learners belonged to which class, which cases were assigned, which attempts reached debrief and which data were exported. It makes it possible to compare learners under a shared assignment rather than mixing unrelated activity. In that sense, management is not administrative noise. It is the structure that makes educational data meaningful.

Related guides include [Users and roles](/admin/users-roles), [Multi-tenant operations](/admin/multi-tenant), [Classes and join codes](/educator/cohorts), [Assigning cases](/educator/assigning-cases), [Classroom policy](/educator/classroom-policy), [Reporting and analytics](/educator/reporting), and [Analytics, evidence and research traces](/product/analytics).
