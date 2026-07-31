import type { Project } from '@/types';

export const getNextProjectPriority = (
  projects: Pick<Project, 'createdAt' | 'priorityNumber'>[],
  year = new Date().getFullYear()
) => projects.reduce((highestPriority, project) => {
  const projectYear = new Date(project.createdAt).getFullYear();
  if (projectYear !== year) return highestPriority;

  return Math.max(highestPriority, project.priorityNumber);
}, 0) + 1;
