import { useEffect, useRef, useState } from 'react';
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
      {challenge.trust ? (
        <HostKeyForm
          title={title}
          request={challenge.trust}
          onAnswer={onAnswer}
          onCancel={onCancel}
        />
      ) : (
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
      )}
    </dialog>
  );
}

function HostKeyForm({
  title,
  request,
  onAnswer,
  onCancel,
}: {
  title: string;
  request: NonNullable<SshChallenge['trust']>;
  onAnswer: (answers: string[]) => void;
  onCancel: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (request.previous && confirmation !== request.fingerprint) return;
        onAnswer([request.previous ? confirmation : 'trust']);
      }}
    >
      <h2 id="ssh-challenge-title">
        {request.previous ? 'Server key changed' : 'Unknown server key'} — {title}
      </h2>
      <p>
        {request.address.includes(':') ? `[${request.address}]` : request.address}:{request.port}
      </p>
      {request.previous ? (
        <>
          <p>
            The saved identity differs. This connection will be refused. Verify the change with the
            server administrator before replacing the saved key.
          </p>
          <p>Saved fingerprint</p>
          <code className="host-fingerprint">{request.previous}</code>
        </>
      ) : (
        <p>
          This server is not trusted yet. Compare its fingerprint through a trusted channel before
          saving it.
        </p>
      )}
      <p>Presented fingerprint</p>
      <code className="host-fingerprint">{request.fingerprint}</code>
      {request.previous && (
        <label>
          Type the verified new fingerprint
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={50}
          />
        </label>
      )}
      <div className="dialog-actions">
        <button autoFocus type="button" onClick={onCancel}>
          Cancel connection
        </button>
        <button type="submit" disabled={!!request.previous && confirmation !== request.fingerprint}>
          {request.previous ? 'Replace saved key and cancel connection' : 'Trust and save key'}
        </button>
      </div>
    </form>
  );
}
