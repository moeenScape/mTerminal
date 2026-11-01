import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { validFileName, type FileEntry, type FileOperation } from '../../../../shared/files';

export interface FileAction {
  action: FileOperation['action'];
  path: string;
  sessionId: string | null;
  entry: FileEntry | undefined;
}
export function FileOperationDialog({
  action,
  scope,
  onConfirm,
  onCancel,
}: {
  action: FileAction;
  scope: string;
  onConfirm: (operation: FileOperation) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(
    action.action === 'chmod' ? action.entry!.permissions : (action.entry?.name ?? ''),
  );
  const label = {
    mkdir: 'Create folder',
    rename: 'Rename',
    delete: 'Delete permanently',
    chmod: 'Change permissions',
  }[action.action];
  return (
    <ConfirmDialog
      title={`${label}?`}
      confirmLabel={label}
      danger={action.action === 'delete'}
      onCancel={onCancel}
      onConfirm={async () => {
        const name = action.entry?.name ?? value;
        if ((action.action === 'mkdir' || action.action === 'rename') && !validFileName(value))
          throw new Error(
            'Enter one name without slashes or control characters; dot and dot-dot are not allowed.',
          );
        if (action.action === 'rename' && value === name)
          throw new Error('Enter a different name.');
        if (action.action === 'chmod' && !/^[0-7]{3,4}$/.test(value))
          throw new Error('Enter three or four octal digits, such as 755 or 0644.');
        const operation: FileOperation =
          action.action === 'rename'
            ? { action: 'rename', name, newName: value }
            : action.action === 'chmod'
              ? { action: 'chmod', name, mode: value }
              : { action: action.action, name };
        await onConfirm(operation);
      }}
    >
      <p>{scope}</p>
      <p className="file-operation-path">{action.entry?.path ?? action.path}</p>
      {action.action === 'delete' ? (
        <p>
          {action.entry?.kind === 'directory'
            ? 'Only this empty folder will be removed. Nonempty folders are refused.'
            : action.entry?.kind === 'symlink'
              ? 'Only the symbolic link will be removed. Its target is kept.'
              : 'This file will be permanently removed.'}{' '}
          This does not use the trash and cannot be undone.
        </p>
      ) : (
        <label>
          {action.action === 'chmod'
            ? 'Octal permissions'
            : action.action === 'rename'
              ? 'New name'
              : 'Folder name'}
          <input
            value={value}
            maxLength={action.action === 'chmod' ? 4 : 255}
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      )}
      {action.action === 'rename' && (
        <p>Rename within this folder. Existing destinations are refused.</p>
      )}
      {action.action === 'chmod' && (
        <p>
          Applies to this item only, without elevation or recursion. Special permission bits are
          included in a four-digit mode.
        </p>
      )}
    </ConfirmDialog>
  );
}
