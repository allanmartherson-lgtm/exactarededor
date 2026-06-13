/**
 * Singleton do hospital ativo.
 *
 * Guarda o ID do hospital atualmente selecionado em memória de módulo, para que
 * o `fetch` customizado do client Supabase (ver client.ts) possa anexar o header
 * `x-active-hospital` em TODA requisição (REST/PostgREST + Edge Functions).
 *
 * Esse header é o que ativa a RLS RESTRICTIVE `active_hospital_scope` no banco.
 * Sem ele, `current_active_hospital()` retorna NULL e o banco devolve dados de
 * qualquer hospital ao qual o usuário tem acesso (vazamento multi-tenant).
 *
 * Importante: o valor mora aqui, fora do React, porque o client Supabase é
 * criado uma única vez na inicialização e o fetch precisa ler o valor MAIS
 * RECENTE a cada request, sem recriar o client ao trocar de hospital.
 */

export const ACTIVE_HOSPITAL_HEADER = "x-active-hospital";

let activeHospitalId: string | null = null;

/** Define o hospital ativo. Passe null para limpar (ex.: durante a troca/logout). */
export const setActiveHospitalId = (hospitalId: string | null): void => {
  activeHospitalId = hospitalId;
};

/** Lê o hospital ativo atual. Usado pelo fetch customizado do client. */
export const getActiveHospitalId = (): string | null => activeHospitalId;
