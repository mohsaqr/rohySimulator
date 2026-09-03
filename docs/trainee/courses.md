# Courses, lessons & surveys

Beside the clinical rooms, a case can carry **course** material: lessons to
read and work through, and surveys to answer. You reach it from the black
**Course** button at the right end of the bottom navigation bar. A course is
the same thing your instructor calls a **class** (a *cohort* in the API);
enrolment, lessons, surveys and case assignment all hang off it.

## Joining a course

There are four ways you end up in one:

1. **Automatically.** Each tenant has one default course flagged for
   auto-enrolment. Every account is put into it when you register and again
   at each sign-in, so you always have at least one course and at least the
   default case.
2. **With a join code.** Open **My Profile** from the top bar, go to the
   **Join a class** tab, type the code your teacher shared into **Join
   code**, and click **Join class**. The code is folded to upper case and
   stripped of separators before it is looked up, so `abc-123` and `ABC123`
   are the same code.
3. **With an invite.** An invitation link or code used on the sign-up screen
   can carry a course. When it does, the register screen says *"You've been
   invited to join {course}."* and you are enrolled as your account is
   created.
4. **Your teacher adds you.** Instructors can enrol people directly from the
   class roster. See [Classes (cohorts) & join codes](/educator/cohorts).

If the code is wrong you get `Could not join — check the code and try again`.
**That class has been closed** means the code was right and the class is gone.

## Seeing the classes you are in

The same **My Profile → Join a class** tab lists **My classes** underneath
the form: the name of each class you are a live member of, its description,
and the date you joined. The list refreshes after a successful join. Before
you have joined anything it reads `You haven't joined a class yet — enter a
code above to join one.`

## How a case relates to a course

A case belongs to at most one course. Your instructor sets that link when
they assign the case to a class (see
[Assigning cases](/educator/assigning-cases)). Two things follow from it:
in **Settings → Cases** the cases are grouped under the heading of the
course they belong to, and the **Course** button opens the course of
whichever case you currently have loaded. Which cases you can start is also
driven by enrolment: the default case in the default course, plus the cases
assigned to classes you are a live member of.

## Opening the Course view

The **Course** button sits at the right end of the bottom bar, in black with
a book icon, next to the room buttons. It appears on the in-session surfaces
once a case is loaded and a session has started, so start the case first
(see [Getting started](/trainee/getting-started)).

Clicking it resolves the active case to a course and opens it, preferring a
course you are enrolled in. The header shows the course name and a **Back to
simulation** button that returns you to the room you left; your session keeps
running while you are in there. When the case is linked to no course you can
reach, the view shows **No course content here** with *"This case is not
linked to a course yet."*

## What a course holds

The course opens on a contents list, headed by the course name and a line
counting its lessons, its surveys, and how many items you have completed. A
toggle switches between **cards** and **list**.

- A **lesson** card shows the title, the description, how many sections it
  has, and a duration in minutes when the author set one.
- A **survey** card shows the title, the description, how many questions it
  has, and a **Survey** tag.

Only published material reaches you; drafts stay with their author. When a
course holds exactly one lesson and no surveys, that lesson opens directly
and is the whole view.

## Working through a lesson

Open a lesson and its sections render in order. A section can be:

- **Text**, written in Markdown or HTML, which can also carry embedded blocks
  such as a video, a multiple-choice question, a link, an embed, or a file.
- **A file**, shown as a download card with the file name, type and size.

Use **All contents** at the top left to go back to the list when the course
holds more than one item.

**Mark complete** is at the top right of the lesson. Clicking it records the
completion against your account and the button changes to **Completed**.
Completed lessons then carry a check mark in the contents list and count
toward the total in the course header.

::: tip Completion is a click you make
Reading a lesson to the end leaves it unmarked. Click **Mark complete**
yourself. The record is per lesson and per learner, and it persists across
sessions and sign-ins.
:::

## Surveys

Open a survey card and its questions appear numbered in order, in three
shapes: single choice, multiple choice, and free text. A question the author
marked as required must be answered before the form will submit; leaving one
blank shows **This question is required** against it, and the server applies
the same rule.

Click **Submit Survey** to send your answers. The form is replaced by
**Survey Completed** with a thank-you message, and reopening the survey later
shows that same card. You get one response per survey per course; a second
submission is refused with **You have already responded**.

::: warning Anonymous surveys behave differently
When a survey is marked anonymous, your answers are stored without your user
id. Because there is no record of who answered, an anonymous survey does not
show the completed card and does not block a second submission.
:::

Surveys live inside the course view. Nothing prompts you to fill one in when
you click **End & Debrief**; you open them yourself from the Course button.

## What you can see of your own progress

- Which lessons you have marked complete, as a check mark on each card and a
  completed count in the course header.
- Which surveys you have submitted, as the completed card.
- Which classes you belong to and when you joined, under **My Profile → Join
  a class**.

Roster views, per-student session reports and course analytics are for
instructors and are scoped to the classes they own.

## Next steps

- [Getting started](/trainee/getting-started) for signing in and loading your
  first case
- [The rooms](/trainee/rooms) for the bottom bar and how rooms work
- [Classes (cohorts) & join codes](/educator/cohorts) for the instructor side
