# TNA analytics

**Transition Network Analysis (TNA)** turns the stream of actions your
students took into a network: what they tended to do, and what they tended to
do *next*. It answers "how did this class work through the case".

You see TNA in two places, both using the same library and the same maths:

- The **Analytics** view inside a class's **Reports** tab, holding the
  **Behaviour network**, **Centrality** and **State frequency** cards. This is
  scoped to your class and your chosen drill (whole class, a student, or a
  session).
- The admin TNA dashboard (admins only), a fuller workbench with extra tabs.

## How the network is built

The pipeline is: build a transition model from the activity sequences ->
prune weak edges -> compute centralities -> lay the graph out. The sequences
are merged server-side so each node is a clinically meaningful state rather
than a raw event verb.

A model is only built when there is enough sequenced activity. A scope that is
too sparse shows "Not enough sequenced activity to build a transition
network for this scope". Widen the scope, from one session up to the whole
class, or wait for more runs.

## How to read it

- **Nodes** are activity states (e.g. categories of action a learner took).
- **Edges** are transitions: an arrow from A to B means learners moved from
  doing A to doing B. Heavier and retained edges are the more common
  transitions; weak edges are pruned out so the dominant flow is visible.
- **Centrality** ranks states by how structurally important they are in the
  flow. A high-centrality state is one most paths pass through, often a hub
  of the class's approach.
- **State frequency** shows how often each state occurred overall, regardless
  of transitions.

Use the scope drill to compare: the whole class's network versus a
struggling student's, or one session versus another, to see *where* a
learner's path diverged.

## Reading it honestly

- TNA describes **behaviour patterns**. Correctness sits outside it, so
  interpret a frequent transition against the case's intended workflow.
- The network reflects what was logged as activity. Quiet steps a learner
  took off-screen are absent from it.
- It is descriptive analytics for reflection and debrief. It performs no
  automated assessment and assigns no grade.

## Reference

- API: [`GET /api/cohorts/:id/analytics/tna-sequences`](/reference/api/cohorts)
  and the other `.../analytics/*` endpoints
- Where it appears: [Reporting & analytics](/educator/reporting)
- Glossary: [Learning event](/reference/glossary)
