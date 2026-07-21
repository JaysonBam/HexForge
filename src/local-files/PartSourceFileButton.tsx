import { useCallback, useEffect, useState } from 'react';
import { Loader2, Usb } from 'lucide-react';
import type { LocalProjectFile } from '../../shared/localHelperProtocol';
import type { Part, Project } from '../types';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { Button } from '../components/ui/Button';
import { useLocalHelper } from './LocalHelperContext';
import { findLinkedLocalFile, sourceFileName } from './sourceFileLink';
import { getAvailableProjectFiles } from './projectLocalFileAvailability';

export const PartSourceFileButton = ({
  part,
  project,
  className = ''
}: {
  part: Part;
  project: Project;
  className?: string;
}) => {
  const { state, client } = useLocalHelper();
  const { notify } = useFeedback();
  const [copying, setCopying] = useState(false);
  const [availableFile, setAvailableFile] = useState<LocalProjectFile | null>(null);

  const refreshAvailability = useCallback(async () => {
    if (state !== 'connected' || !part.sourceFilePath) {
      setAvailableFile(null);
      return;
    }
    try {
      const files = await getAvailableProjectFiles(project, client, true);
      const file = findLinkedLocalFile(part.sourceFilePath, files);
      setAvailableFile(file?.group === 'print_ready' ? file : null);
    } catch {
      setAvailableFile(null);
    }
  }, [client, part.sourceFilePath, project, state]);

  useEffect(() => {
    void refreshAvailability();
    window.addEventListener('focus', refreshAvailability);
    return () => window.removeEventListener('focus', refreshAvailability);
  }, [refreshAvailability]);

  if (!part.sourceFilePath || !availableFile) return null;

  const filename = sourceFileName(part.sourceFilePath);
  const copyToPrinter = async () => {
    setCopying(true);
    try {
      const files = await getAvailableProjectFiles(project, client, true);
      const file = findLinkedLocalFile(part.sourceFilePath as string, files);
      if (!file || file.group !== 'print_ready') {
        setAvailableFile(null);
        throw new Error(`${filename} is no longer available in the project folder.`);
      }

      let operation = await client.startCopy(file.fileId);
      const deadline = Date.now() + 5 * 60_000;
      while (['awaiting_destination', 'copying'].includes(operation.status) && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        operation = await client.getCopyOperation(operation.operationId);
      }
      if (operation.status === 'completed') {
        notify({ title: 'Copied to destination', message: `${filename} was copied and verified.`, tone: 'success' });
      } else if (operation.status === 'cancelled') {
        notify({ title: 'Copy cancelled', message: `${filename} was not copied.`, tone: 'info' });
      } else {
        throw new Error(operation.error || 'The copy could not be completed.');
      }
    } catch (error) {
      notify({ title: 'Copy failed', message: error instanceof Error ? error.message : 'The linked file could not be copied.', tone: 'error' });
      await refreshAvailability();
    } finally {
      setCopying(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={`h-8 w-10 shrink-0 p-0 ${className}`}
      disabled={copying}
      onClick={() => void copyToPrinter()}
      aria-label={`Copy ${filename} to printer media`}
      title={`Copy ${filename} to printer media`}
    >
      {copying ? <Loader2 size={14} className="animate-spin" /> : <Usb size={14} />}
    </Button>
  );
};
