# Drop-in install

You're putting this kit into a brand-new project. Here's the minimal
sequence to a working talking avatar in your app.

## 1. Copy the kit

Pick a folder name in your repo (suggestion: `vendor/talking-avatars/`)
and copy the whole kit there:

```bash
cp -R kits/talking-avatars vendor/talking-avatars
```

The 226 MB of GLBs come along by default. If your repo doesn't want them
tracked, add `vendor/talking-avatars/glbs/*.glb` to `.gitignore` and use
git-lfs or an asset host instead. The runtime just expects to fetch them
from `<baseUrl>/avatars/heads/<filename>.glb`.

## 2. Move the GLBs to your public asset folder

The kit's `client/PatientAvatar.jsx` fetches `<baseUrl>/avatars/heads/<id>.glb`.
For Vite or Next.js with default settings, that means putting them under
`public/`:

```bash
mkdir -p public/avatars/heads
mv vendor/talking-avatars/glbs/*.glb public/avatars/heads/
mv vendor/talking-avatars/glbs/manifest.json public/avatars/heads/
```

Now `<baseUrl>('/avatars/heads/avatarsdk.glb')` resolves to `/avatars/heads/avatarsdk.glb`
which Vite serves from `public/`. If your asset root differs, edit
`client/config.js` — only two functions to change.

## 3. Install client deps

```bash
npm install three @react-three/fiber @react-three/drei wawa-lipsync
```

## 4. Mount the provider and render the avatar

```jsx
// App.jsx
import { VoiceProvider, useVoice } from './vendor/talking-avatars/client/VoiceContext.jsx';
import PatientAvatar from './vendor/talking-avatars/client/PatientAvatar.jsx';

function App() {
    return (
        <VoiceProvider>
            <Talker />
        </VoiceProvider>
    );
}

function Talker() {
    const { visemes, speaking, listening, headManifest, setHeadManifest } = useVoice();

    // One-time: load the manifest so the resolver knows which GLBs exist.
    useEffect(() => {
        fetch('/avatars/heads/manifest.json')
            .then(r => r.json())
            .then(setHeadManifest);
    }, [setHeadManifest]);

    return (
        <div style={{ width: 320, height: 320 }}>
            <PatientAvatar
                patient={{ id: 'demo', name: 'Demo', gender: 'female', age: 35 }}
                speaking={speaking}
                listening={listening}
                visemes={visemes}
                avatarType="full"
                headManifest={headManifest}
            />
        </div>
    );
}
```

## 5. Wire up speak()

Add a button or a chat-reply handler that calls the voice service:

```js
import { VoiceService } from './vendor/talking-avatars/client/voiceService.js';
import { useVoice } from './vendor/talking-avatars/client/VoiceContext.jsx';

function SpeakButton({ text }) {
    const { setSpeaking, setVisemes } = useVoice();
    return (
        <button onClick={() => {
            VoiceService.speak({
                text,
                voice: 'af_bella',     // a Kokoro voice id (call /api/tts/voices to list)
                onStart: () => setSpeaking(true),
                onVisemes: setVisemes,
                onEnd: () => { setSpeaking(false); setVisemes({ viseme_sil: 1 }); },
                onError: (err) => console.error(err),
            });
        }}>Speak</button>
    );
}
```

That's the complete client side.

## 6. Set up the server

```bash
npm install express
# Pick at least one provider:
npm install kokoro-js @huggingface/transformers   # local, free, ~330 MB model on first run
# or
# (Google needs no extra package — it's REST. Just an API key in env.)
```

Wire the route handler:

```js
// server.js
import express from 'express';
import ttsRouter from './vendor/talking-avatars/server/ttsRoute.js';

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use('/api', ttsRouter);
app.listen(3000);
```

For Google, set `GOOGLE_TTS_API_KEY` in the environment and call the
endpoint with `?provider=google`. Default is Kokoro.

If you want auth, add your middleware before the kit's router:

```js
app.use('/api', authenticateToken, ttsRouter);
```

…and make sure `client/authService.js` returns a valid token from
`AuthService.getToken()`. The kit's voiceService already sends it as
`Authorization: Bearer <token>` on every TTS call.

## 7. Verify

1. Hit `GET /api/tts/voices?provider=kokoro` — should return a list. (First
   call downloads the ~330 MB Kokoro model; that hangs ~30 s and is
   expected. Subsequent calls are instant.)
2. Hit your client page. The 3D head should render.
3. Click "Speak" — the head's mouth should move along with the audio.

## Optional: convert more RocketBox avatars

The 28 GLBs in `glbs/` cover most demographics, but if you need more:

```bash
cd vendor/talking-avatars/pipeline
npm install                    # ~12 MB FBX2glTF binary
# edit avatars.json to add the new entry
npm run convert -- --only=rb_male_adult_22
# add the same entry to public/avatars/heads/manifest.json
```

See `pipeline/README.md` for full pipeline details.

## Troubleshooting

See section 15 of the main `README.md` for the standard issue list:
mouth doesn't move, choppy audio, Kokoro hangs, Google 403, AudioContext
warnings, missing morphTargetDictionary.
