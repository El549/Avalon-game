import { BoardRoom } from "./BoardRoom";
import { Home } from "./Home";
import { PlayerRoom } from "./PlayerRoom";

export function App() {
  const match = window.location.pathname.match(/^\/room\/(\d{6})(?:\/(board))?\/?$/);
  if (!match) return <Home />;
  const [, roomCode, view] = match;
  return view === "board" ? <BoardRoom roomCode={roomCode} /> : <PlayerRoom roomCode={roomCode} />;
}
