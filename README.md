# Kisunla AI Patient Simulator

A voice-driven training simulator that lets a doctor/sales rep practice a clinical
interview with **Farah Siddiqui**, an AI-voiced, AI-rendered patient with suspected
early symptomatic Alzheimer's disease. The rep talks out loud; the patient listens,
responds in natural speech through a live avatar, and can be interrupted like a real
conversation.

## How it works

```
Browser (mic + speakers)
   │  HTTPS / WSS
   ▼
nginx  (:8085 → :80 in-container)
   ├── /            → frontend (Next.js, :3000)
   └── /api/*       → backend  (FastAPI, :8000)
                         ├── /api/auth      simple username/password gate → signed token
                         ├── /api/anam      mints a short-lived Anam.ai session token
                         │                  (renders Farah's talking-head avatar)
                         └── /api/session/relay
                                            WebSocket relay to OpenAI's Realtime API
                                            (speech-to-speech conversation as Farah,
                                            using the persona/history baked into the
                                            backend prompt)
```

- **Frontend** — Next.js 14 / React 18. Handles login, mic capture, the Anam avatar
  video element, live transcript, and session summary screen.
- **Backend** — FastAPI. Proxies to Anam.ai for the avatar token and relays raw audio
  between the browser and OpenAI's Realtime API over a WebSocket, translating any
  non-English transcript back to English for the transcript panel.
- **nginx** — single entrypoint that reverse-proxies `/api/*` to the backend and
  everything else to the frontend, so the browser only ever talks to one origin/port.

Third-party services used: **OpenAI** (Realtime API + `gpt-4o-mini` for
translation/summarization) and **Anam.ai** (avatar rendering). `SIMLI_*` env vars are
left over from an earlier avatar pipeline and are not currently wired up.

## Prerequisites

Pick one of the two run modes below.

- **Docker mode (recommended):** [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Compose v2.
- **Local mode:** Python 3.11+, Node.js 20+.

Either way you'll need API keys for:
- an **OpenAI** account with Realtime API access ([platform.openai.com](https://platform.openai.com/api-keys))
- an **Anam.ai** account ([anam.ai](https://anam.ai)) with a persona/avatar/voice configured

## 1. Clone and configure environment variables

```bash
git clone https://github.com/jalal1808/ai-patient.git
cd ai-patient
```

Copy the example env files and fill in real values (never commit the real `.env` files —
they're already git-ignored):

```bash
cp .env.example .env                                   # used by docker-compose
cp backend/.env.example backend/.env                   # used only if running backend without Docker
cp frontend/.env.local.example frontend/.env.local      # used only if running frontend without Docker
```

At minimum, set in `.env`:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI key with Realtime API access |
| `ANAM_API_KEY` | ✅ | Anam.ai API key |
| `ANAM_PERSONA_ID` / `ANAM_AVATAR_ID` | ✅ | Which Anam avatar to render (avatar id is preferred; persona id used as fallback) |
| `ANAM_VOICE_ID` | ✅ | Anam voice to speak with |
| `APP_USERNAME` / `APP_PASSWORD` | ✅ | Login credentials for the demo gate |
| `JWT_SECRET` | ✅ | Random string used to sign session tokens — set your own before deploying |
| `OPENAI_MODEL`, `OPENAI_VOICE`, `SEMANTIC_VAD_EAGERNESS`, `NOISE_REDUCTION_TYPE`, `AUDIO_SAMPLE_RATE` | optional | tuning, sensible defaults already set |
| `SIMLI_*` | optional | unused by the current Anam-based flow |

## 2. Run it

### Option A — Docker Compose (recommended)

```bash
docker compose up --build
```

Then open **http://localhost:8085**.

This builds and runs three containers — `backend` (uvicorn, hot-reload), `frontend`
(Next.js dev server), `nginx` (reverse proxy on port 8085) — wired together by
[docker-compose.yml](docker-compose.yml). Source is bind-mounted, so edits to
`backend/` or `frontend/` reload live. Stop with `Ctrl+C`, or `docker compose down`.

### Option B — Run locally without Docker

**Backend** (terminal 1, from `backend/`):
```bash
cd backend
python -m venv env
env\Scripts\activate          # Windows
# source env/bin/activate     # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend** (terminal 2, from `frontend/`):
```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000**. The frontend talks directly to the backend at
`NEXT_PUBLIC_BACKEND_URL` (set in `frontend/.env.local`, default `http://localhost:8000`) —
there's no nginx in front of it in this mode.

## 3. Log in

Use the credentials you set as `APP_USERNAME` / `APP_PASSWORD`. The login endpoint
issues a signed, 8-hour token (`backend/routers/auth.py`) that the frontend stores and
sends back for later requests.

## Project structure

```
ai-doctor/
├── docker-compose.yml       orchestrates backend + frontend + nginx
├── .env.example              template for docker-compose's env file
├── backend/
│   ├── main.py                FastAPI app, mounts routers, CORS
│   ├── requirements.txt
│   ├── routers/
│   │   ├── auth.py            /api/auth — login + token verification
│   │   ├── anam.py            /api/anam — mints Anam avatar session tokens
│   │   └── session.py         /api/session — realtime relay + summary endpoint
│   └── services/
│       └── openai_realtime.py WebSocket bridge to OpenAI Realtime API + patient prompt
├── frontend/
│   ├── app/
│   │   ├── page.tsx            main simulation screen
│   │   ├── login/page.tsx      login screen
│   │   ├── splash/page.tsx     splash/loading screen
│   │   ├── components/         Avatar.tsx, Transcript.tsx
│   │   └── hooks/               useAnam.ts, useRealtimeRelay.ts
│   └── ...
└── nginx/
    └── nginx.conf             routes / → frontend, /api/* and /health → backend
```

## Troubleshooting

- **Avatar doesn't load / "Anam token error"** — check `ANAM_API_KEY`,
  `ANAM_AVATAR_ID`/`ANAM_PERSONA_ID`, and `ANAM_VOICE_ID` are correct and the Anam
  account has an active persona configured with that voice.
- **No response from the patient / WebSocket closes immediately** — check
  `OPENAI_API_KEY` has Realtime API access, and that the model in `OPENAI_MODEL` is
  available to your account.
- **401 on login** — confirm `APP_USERNAME`/`APP_PASSWORD` in your `.env` match what
  you're typing, and that the frontend/backend are pointed at each other correctly
  (`NEXT_PUBLIC_BACKEND_URL` in local mode, or the nginx proxy in Docker mode).
- **Port already in use** — change the published port in `docker-compose.yml`
  (`nginx.ports`, currently `8085:80`) or stop whatever else is bound to it.
