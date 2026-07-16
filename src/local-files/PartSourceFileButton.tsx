import { useState } from 'react';
import { Loader2, Usb } from 'lucide-react';
import type { Part, Project } from '../types';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { Button } from '../components/ui/Button';
import { useLocalHelper } from './LocalHelperContext';
import { findLinkedLocalFile, sourceFileName } from './sourceFileLink';

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

  if (!part.sourceFilePath) return null;

  const filename = sourceFileName(part.sourceFilePath);
  const copyToPrinter = async () => {
    setCopying(true);
    try {
      const resolution = await client.resolveProject({
        projectId: project.id,
        priorityNumber: project.priorityNumber,
        studentName: project.studentName,
        studentNumber: project.studentNumber,
        module: project.course
      });
      if (resolution.status !== 'matched' && resolution.status !== 'created') {
        throw new Error(resolution.status === 'ambiguous'
          ? 'More than one local project folder matches. Choose the folder in Local files first.'
          : 'The local project folder could not be found.');
      }

      const response = await client.listProjectFiles(resolution.projectKey);
      const file = findLinkedLocalFile(part.sourceFilePath as string, response.files);
      if (!file) throw new Error(`${filename} is no longer available in the project folder.`);
      if (file.group !== 'print_ready') throw new Error(`${filename} is not a print-ready file.`);

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
    } finally {
      setCopying(false);
    }
  };

  const helperReady = state === 'connected';
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={`h-8 w-10 shrink-0 p-0 ${className}`}
      disabled={!helperReady || copying}
      onClick={() => void copyToPrinter()}
      aria-label={`Copy ${filename} to printer media`}
      title={helperReady ? `Copy ${filename} to printer media` : 'Printing Manager Helper is not connected'}
    >
      {copying ? <Loader2 size={14} className="animate-spin" /> : <Usb size={14} />}
    </Button>
  );
};
