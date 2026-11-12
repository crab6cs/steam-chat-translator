export interface Translation { ok: true; translated: string; source: string }
export interface Queue {
  run(text: string, stillWanted?: () => boolean): Promise<Translation>;
  stop(): void;
}
export interface Settings {
  enabled: boolean;
  ready?: boolean;
  provider?: string;
  status?: string;
  openSettings?(): void;
  setEnabled(value: boolean): void;
  subscribe(listener: () => void): () => unknown;
}
export const STYLE: string;
export function eligibleText(text: string): boolean;
export function languageName(code: string): string;
export function createQueue(translate: (texts: string[]) => Promise<unknown>, gap?: number, batchWait?: number, onStatus?: (status:string)=>void): Queue;
export function mountChatDocument(doc: Document, queue: Queue, settings: Settings): {scan(): void; dispose(): void};
