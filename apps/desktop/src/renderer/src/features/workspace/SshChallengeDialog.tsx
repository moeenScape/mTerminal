import { useEffect, useRef } from 'react';
import type { SshChallenge } from '../../../../shared/ssh';

export function SshChallengeDialog({
  title,
  challenge,
  onAnswer,
  onCancel,
}: {
  title: string;
  challenge: SshChallenge;
  onAnswer: (answers: string[]) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="terminal-dialog"
      aria-labelledby="ssh-challenge-title"
      onCancel={onCancel}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const answers = challenge.prompts.map((_prompt, index) =>
            String(data.get(`answer-${index}`) ?? ''),
          );
          event.currentTarget.reset();
          onAnswer(answers);
        }}
      >
        <h2 id="ssh-challenge-title">Authenticate “{title}”</h2>
        <p>Server authentication request</p>
        <p>{challenge.title}</p>
        <p>{challenge.instructions}</p>
        {challenge.prompts.map((prompt, index) => (
          <label key={index}>
            {prompt.prompt || `Response ${index + 1}`}
            <input
              autoFocus={index === 0}
              name={`answer-${index}`}
              type={prompt.echo ? 'text' : 'password'}
              maxLength={4096}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel connection
          </button>
          <button type="submit">Submit answers</button>
        </div>
      </form>
    </dialog>
  );
}
