import { useEffect, useState } from 'react';
import { useClutchState } from '../services/clutchState';
import {
  fetchSeniors,
  setSessionSenior,
  sortSeniors,
  type SeniorOption,
} from '../services/smurfApi';

export function SeniorPicker() {
  const { state } = useClutchState();
  const [options, setOptions] = useState<SeniorOption[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchSeniors().then((result) => {
      if (cancelled) return;
      setOptions(sortSeniors(result.options));
      setDefaults(result.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== 'idle' || state.messages.length > 0) {
    return null;
  }

  const handleChange = async (key: string) => {
    setSelected(key);
    setNote('');
    if (!key) return;
    try {
      const saved = await setSessionSenior(state.run_id, key);
      setNote(saved ? 'saved' : 'could not save');
    } catch {
      setNote('could not save');
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-3 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-1.5 text-[11px] text-on-surface-variant">
        <label htmlFor="senior-model" className="font-semibold">
          Senior model
        </label>
        <select
          id="senior-model"
          value={selected}
          onChange={(event) => void handleChange(event.target.value)}
          className="rounded-md border border-outline-variant/40 bg-white/70 px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        >
          <option value="">{`Default (${defaults.join(', ')})`}</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {`${option.key} - ${option.billing}${option.cooling ? ' (cooling)' : ''}`}
            </option>
          ))}
        </select>
        {note ? <span className="text-[10px]">{note}</span> : null}
      </div>
    </div>
  );
}
