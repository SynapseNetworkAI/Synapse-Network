export type AppRole = 'CONSUMER' | 'PROVIDER' | 'ADMIN' | null;

export const setAppRole = (role: AppRole) => {
  if (typeof window !== 'undefined' && role) {
    localStorage.setItem('a2a_selected_role', role);
  }
};

export const getAppRole = (): AppRole => {
  if (typeof window !== 'undefined') {
    const role = localStorage.getItem('a2a_selected_role');
    if (role === 'CONSUMER' || role === 'PROVIDER' || role === 'ADMIN') {
      return role as AppRole;
    }
  }
  return null;
};
