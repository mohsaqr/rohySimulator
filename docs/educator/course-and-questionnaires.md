# Course materials and questionnaires

A case can hold back its course materials until the learner has worked on the
case, and it can ask the learner questionnaires: once during the case, once
after the materials open, or twice as a pre-test and post-test.

You set this up in the case wizard's **Course** step. Learners see it at the
top of the **Course** view, which they open from the room bar.

## Course materials that open after the case

Course materials often explain the case's answer. A lesson that teaches
colorectal adenocarcinoma gives away a case whose answer is colorectal
adenocarcinoma, so you can lock it until the learner has done the work.

The **Course** step has two conditions:

- **Minutes after the learner starts the case.** The time counts from the
  learner's first session on the case, so leaving and coming back does not
  reset it.
- **Every pathology slide opened.** Each slide of the case must have been
  opened at least once. A case without slides meets this condition at once.

A locked lesson opens for a learner when every condition you set is met. Until
then the learner sees its title and how far they are, with the time left and
the slides opened. The server does not send the lesson's text, sections or
video to the learner before then, and asking for them directly is refused.
Once a lesson has opened, it stays open.

To choose which lessons wait:

1. Link the case to a course (**Assigning cases**).
2. Save the case.
3. In the **Course** step, tick the lessons that wait for this case and
   select **Save locked lessons**.

The locked lessons save at once. The conditions save with the case.

::: warning Opened slides are reported by the learner's browser
The time condition is measured by the server and cannot be faked. The slide
condition counts the slide-opened events that the learner's browser reports.
That is enough to hold back teaching material, but do not use it to lock an
exam.
:::

## Questionnaires

A questionnaire has single-choice, multiple-choice and free-text questions. It
is answered at one of three times:

| When | Answered |
|---|---|
| Once, at any time during the case | once, whenever the learner chooses |
| Pre/post test | twice, with the same questions: before the materials open, then again after |
| Once, after the materials open | once, after the course materials open |

A pre-test closes when the materials open. A learner who did not take it can
still take the post-test.

**Graded** questionnaires have correct answers. Mark the correct option on each
choice question, and add feedback if you like. Each choice question with a
correct answer is worth one point. A multiple-choice question scores only when
the learner picks exactly the correct options. Free-text questions are not
scored.

The correct answers and feedback stay on the server until the learner's
answers are in. After a pre-test the learner sees neither the score nor the
answers, because they would give away the post-test. After the post-test they
see both scores and the feedback.

The questionnaires are part of the case, so they move with it when you export
it or send it as a case package. The answers stay on the server where they
were given.

## Reading the answers

In the **Course** step, **Show answers** lists every answer to the case's
questionnaires, with the learner's username, attempt, score and time.
**Download CSV** writes one row per answer, with the question and the chosen
option's text. A spreadsheet or R reads that shape directly.

Each answer keeps a copy of the questions as they were when the learner
answered. If you change a questionnaire later, older answers still show what
was asked.

## Reference

- Endpoints: [Case course API](/reference/api/case-course) and the lesson
  routes in [Lessons API](/reference/api/lessons).
- Storage: `cases.config.courseGate` and `cases.config.questionnaires`, the
  `lessons.unlock_case_id` column and the `case_questionnaire_responses`
  table ([Data reference](/reference/data/)).
