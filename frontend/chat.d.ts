export interface Translation { ok: true; translated: string; source: string }
export interface Queue {
  run(text: string, stillWanted?: () => boolean): Promise<Translation>;
  stop(): void;
}
export interface Settings {
  enabled: boolean;
  setEnabled(value: boolean): void;
  subscribe(listener: () => void): () => unknown;
}
export const STYLE: string;
export function eligibleText(text: string): boolean;
export function languageName(code: string): string;
export function createQueue(translate: (text: string) => Promise<unknown>, gap?: number): Queue;
export function mountChatDocument(doc: Document, queue: Queue, settings: Settings): {scan(): void; dispose(): void};
