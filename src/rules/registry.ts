/**
 * The game roster. Adding a game = one file in games/ + one line here (CLAUDE.md invariant 12).
 */
import type { GameModule } from './module';
import { klondike } from './games/klondike';

export const GAMES: GameModule<any>[] = [klondike];

export function gameById(id: string): GameModule<any> | undefined {
  return GAMES.find((g) => g.id === id);
}
