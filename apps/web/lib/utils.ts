import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, resolving Tailwind conflicts via tailwind-merge.
 * Standard shadcn/ui helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
