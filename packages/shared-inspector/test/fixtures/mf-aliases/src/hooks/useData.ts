// Hook behind @hooks/* alias
// imports @tanstack/react-query — should be visible in local-graph+tsconfig mode
import { useQuery } from '@tanstack/react-query';

export function useData() {
  return useQuery({ queryKey: ['data'], queryFn: async () => null });
}
