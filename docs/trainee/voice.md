# Voice mode

Voice mode carries your speech to the patient and plays their answer aloud,
with an animated avatar. It is optional and available when your instructor
has enabled and configured it.

::: warning Training only
The patient and their voice are simulated. Nothing said here is medical
advice.
:::

## Requirements

Voice mode needs:

- **Voice enabled by your instructor.** If it is off platform-wide, the
  **Voice** button does not appear and you stay in text mode.
- A browser with speech recognition: **Chrome or Edge**. Other browsers may
  lack the ability to listen.
- The site served over **HTTPS**. On an insecure origin the browser silently
  refuses to start the microphone.
- Microphone permission granted to the site.

If a requirement is missing the simulator names what to fix.

## Turn voice on

1. Go to the **Patient** room.
2. Click the **Voice** button at the top-right of the chat panel. It changes
   to **Voice on** and the patient now speaks their replies, with the avatar
   lip-syncing.
3. Click **Voice on** again at any time to return to typing.

## Talk to the patient

On the patient tab in voice mode, the message box is replaced by a single
button:

1. Click **Click to talk**. The button changes to **Listening… click to
   stop**.
2. Speak your question. A pause does not cut you off.
3. Click again to stop. What you said is transcribed and sent, and the
   patient answers out loud.

While the patient is talking the button shows **Patient speaking…**; wait
for them to finish before your next turn.

## The transcript

In voice mode the on-screen transcript is hidden by default, so you listen to
the patient. Use the **Show** / **Hide** control at
the top of the chat panel to bring the written transcript back, or click the
caption area to reveal it. Your conversation is still recorded either way.

## When voice does not work

The simulator surfaces the specific problem so you can fix it. Common cases:

| What you see | What to do |
|---|---|
| "Microphone blocked" | Allow microphone access for the site, and make sure the page is on HTTPS. |
| "Speech recognition is not supported in this browser" | Use Chrome or Edge over HTTPS. |
| "No microphone detected" | Plug in or enable a microphone in your OS. |
| "Did not hear anything" | Speak closer to the mic and try again. |
| Listening ends immediately | The page likely needs to be served over HTTPS. |
| Patient does not speak | Voice may be unconfigured. Tell your instructor; you can still work in text mode. |

If voice fails, switch off **Voice on** and continue in text. Every case runs
in text mode. See the [FAQ](/trainee/faq) for more troubleshooting.

## Next steps

- [Taking a history](/trainee/history)
- [Debrief](/trainee/debrief)
- [FAQ & troubleshooting](/trainee/faq)
