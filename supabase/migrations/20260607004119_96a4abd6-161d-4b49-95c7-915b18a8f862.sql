CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DROP TRIGGER IF EXISTS trg_on_campaign_decision ON public.comm_campaigns;

CREATE TRIGGER trg_on_campaign_decision
AFTER UPDATE OF approval_status ON public.comm_campaigns
FOR EACH ROW
WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
EXECUTE FUNCTION public.on_campaign_decision();