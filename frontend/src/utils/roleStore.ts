export type AppRole = 'CONSUMER' | 'PROVIDER' | 'ADMIN' | null;

export const setAppRole = (role: AppRole, address?: string) => {
  if (typeof window !== 'undefined' && role) {
    localStorage.setItem('a2a_selected_role', role);
    if (address) {
      localStorage.setItem(`a2a_role_${address.toLowerCase()}`, role);
    }
  }
};

export const getAppRole = (address?: string): AppRole => {
  if (typeof window !== 'undefined') {
    if (address) {
      const addressRole = localStorage.getItem(`a2a_role_${address.toLowerCase()}`);
      if (addressRole === 'CONSUMER' || addressRole === 'PROVIDER' || addressRole === 'ADMIN') {
        return addressRole as AppRole;
      }
    }
    const role = localStorage.getItem('a2a_selected_role');
    if (role === 'CONSUMER' || role === 'PROVIDER' || role === 'ADMIN') {
      return role as AppRole;
    }
  }
  return null;
};

export const clearAppRole = (address?: string) => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('a2a_selected_role');
    if (address) {
      localStorage.removeItem(`a2a_role_${address.toLowerCase()}`);
    }
  }
};
