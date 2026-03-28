// DIAMOND: @tanstack/react-query imported DIRECTLY here
// (also re-exported from dashboard/widgets/table.tsx)
// → via should be 'direct' across the whole project
import { useQuery } from '@tanstack/react-query';
export { useStore } from 'zustand';

export function useAuthStore() {
  return useQuery({ queryKey: ['auth'], queryFn: async () => null });
}
