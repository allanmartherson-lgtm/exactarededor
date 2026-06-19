/**
 * DEPRECATED — mantido como no-op para compatibilidade de imports.
 *
 * O hospital ativo agora vive 100% no servidor (tabela `user_active_hospital`,
 * gravada via RPC `set_active_hospital`). A função `current_active_hospital()`
 * no banco lê de lá, sem qualquer dependência de header HTTP.
 *
 * Estes exports não fazem mais nada — só existem para não quebrar imports
 * legados durante a transição. Podem ser removidos em uma próxima limpeza.
 */

export const ACTIVE_HOSPITAL_HEADER = "x-active-hospital";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const setActiveHospitalId = (_hospitalId: string | null): void => {
  // no-op
};

export const getActiveHospitalId = (): string | null => null;
