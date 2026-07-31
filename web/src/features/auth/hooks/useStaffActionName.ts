import { useCallback, useMemo } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useStaffSession } from '../context/StaffSessionContext';
import { useFeedback } from '../components/ui/FeedbackProvider';

export const useStaffActionName = () => {
  const { staffList } = useSettings();
  const { activeStaffName, claimActiveStaffName, setActiveStaffName } = useStaffSession();
  const { prompt } = useFeedback();
  const staffOptions = useMemo(() => Array.from(new Set([
    ...(activeStaffName ? [activeStaffName] : []),
    ...staffList
  ])), [activeStaffName, staffList]);

  const requestStaffName = useCallback(async (action: string) => {
    const currentName = claimActiveStaffName();
    if (currentName) return currentName;

    const values = await prompt({
      title: 'Select staff member',
      message: `Choose who is ${action}. This will also update the workstation name.`,
      confirmLabel: 'Continue',
      tone: 'warning',
      fields: [{
        name: 'staffName',
        label: 'Staff member',
        type: 'select',
        required: true,
        defaultValue: activeStaffName,
        options: staffOptions
      }]
    });
    const selectedName = values?.staffName.trim();
    if (!selectedName) return null;

    setActiveStaffName(selectedName);
    return selectedName;
  }, [activeStaffName, claimActiveStaffName, prompt, setActiveStaffName, staffOptions]);

  return { activeStaffName, requestStaffName, setActiveStaffName, staffOptions };
};
