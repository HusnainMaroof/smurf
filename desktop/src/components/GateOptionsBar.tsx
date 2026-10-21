/**
 * Decision buttons for the live run's waiting options.
 */
import { useEffect, useState } from 'react';
import { clutchStore, useClutchState } from '../services/clutchState';
import {
  BTN_DANGER_SM,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
} from './ui/buttonStyles';

type Waiting = {
  kind: 'approval' | 'escalation' | 'question';
  question: string;
  options: string[];
  taskId?: string;
};

type GateButton = { id: string; label: string; tone: 'primary' | 'danger' | 'neutral' };

/** Pure option-to-button mapping used by the gate bar and its tests. */
export function gateButtons(options: string[]): GateButton[] {
  return options.map((option, index) => ({
    id: option,
    label: option.charAt(0).toUpperCase() + option.slice(1),
    tone:
      option === 'abort' || option === 'reject'
        ? 'danger'
        : index === 0
          ? 'primary'
          : 'neutral',
  }));
}

const TONE_CLASS = {
  primary: BTN_PRIMARY_SM,
  danger: BTN_DANGER_SM,
  neutral: BTN_SECONDARY_SM,
};

export function GateOptionsBar() {
  const { state } = useClutchState();
  const waiting = (state as unknown as { waiting?: Waiting | null }).waiting;
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSending(false);
  }, [state.status]);

  if (state.status !== 'awaiting_human' || !waiting?.options?.length || waiting.kind === 'question') {
    return null;
  }

  const buttons = gateButtons(waiting.options);

  const sendDecision = (decision: string) => {
    if (sending) return;
    setSending(true);
    void clutchStore
      .send({
        action: 'human_decision',
        decision,
        instructions: note || undefined,
      })
      .catch(() => setSending(false));
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-3 pb-2">
      <div className="rounded-xl border border-amber-300/70 bg-amber-50/90 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-900/80">
          {waiting.kind}
        </div>
        <p className="mt-1 max-h-[calc(6*1.375em)] overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-snug text-amber-950">
          {waiting.question}
        </p>
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note for the team (optional)"
          className="mt-2 w-full rounded-md border border-amber-200 bg-white/70 px-2 py-1 text-[11px] text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              disabled={sending}
              onClick={() => sendDecision(button.id)}
              className={TONE_CLASS[button.tone]}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
