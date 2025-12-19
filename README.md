# MicroSkribbl

MicroSkribbl is a blockchain-powered drawing game built on Linera microchains. All core features—except the canvas strokes—run on-chain: room creation and joining, subscriptions, chat, word selection, event handling, and cross-chain messages. The secret word lives only on the artist’s chain; the host never re-emits it.

## Quick Start
- Requirements: Node.js ≥ 18, npm
- Install: `npm i`
- Environment (`.env`):
  - `VITE_LINERA_FAUCET_URL=<faucet URL>`
  - `VITE_LINERA_APPLICATION_ID=<deployed application ID>`
- Run frontend: `npm run dev` (port `3100`)
- Drawing driver (optional): `npm run dev:draw`
- Run both (Windows PowerShell): `npm run dev:all`
- Build: `npm run build`

## Smart-Contract Architecture (microchains)
- Host chain: room state, rounds, timers, current drawer
- Artist chain: secret word; host does not receive it
- Player chains: chat, guessed state, points
- Client subscribes to notifications and queries after each event (`src/components/Game.tsx:177`)

## Contract API (GraphQL)
- Mutations:
  - `createRoom(hostName)` (`src/components/Lobby.tsx:41`)
  - `joinRoom(hostChainId, playerName)` (`src/components/Lobby.tsx:55`)
  - `startGame(rounds, secondsPerRound)` (`src/components/WaitingRoom.tsx:42`)
  - `chooseDrawer` (`src/components/Game.tsx:306`)
  - `chooseWord(word)` (`src/components/Game.tsx:278`)
  - `guessWord(guess)` (`src/components/Game.tsx:290`)
  - `leaveRoom` (`src/components/Game.tsx:377`)
- State query:
  - `room { hostChainId players { chainId name score hasGuessed } gameState currentRound totalRounds secondsPerRound currentDrawerIndex wordChosenAt drawerChosenAt chatMessages { playerName message isCorrectGuess pointsAwarded } }` (`src/components/Game.tsx:93`)

## Wallet & Client Initialization
- Reads `.env`: `VITE_LINERA_FAUCET_URL`, `VITE_LINERA_APPLICATION_ID` (`src/components/LineraProvider.tsx:39-40,92-93`)
- Generates mnemonic, creates wallet and claims chain via Faucet (`src/components/LineraProvider.tsx:54-55,111-112`)
- Creates client and fetches application frontend (`src/components/LineraProvider.tsx:57,114`)
- Auto re-init on WASM errors (`src/components/LineraProvider.tsx:143`)

## Port
- Frontend listens on `3100` (`vite.config.ts:68`)

## Security
- The secret word exists only on the artist’s chain; the host never re-emits it
- Future: add an extra encryption layer for the word

## Troubleshooting
- Stuck on “Initializing Wallet…”: check `VITE_LINERA_FAUCET_URL` and `VITE_LINERA_APPLICATION_ID`
- On WASM runtime errors, the provider auto re-initializes
