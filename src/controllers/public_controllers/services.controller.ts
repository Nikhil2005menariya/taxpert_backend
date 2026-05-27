import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';

function formatDisplayPrice(paise: number | null): string | null {
  if (!paise || paise === 0) return null;
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN")}`;
}

export const getServices = async (req: Request, res: Response) => {
  try {
    const supabase = createServiceClient();

    // Pull categories ordered by sort_order
    const { data: cats, error: catErr } = await supabase
      .from("service_categories")
      .select("id, name, slug, description")
      .eq("is_active", true)
      .order("sort_order");

    if (catErr || !cats || cats.length === 0) {
      return res.json({ data: [] });
    }

    // Pull all active services with their category_id
    const { data: svcs, error: svcErr } = await supabase
      .from("services")
      .select("id, name, slug, summary, description, best_for, price, category_id, sort_order")
      .eq("is_active", true)
      .order("sort_order");

    if (svcErr || !svcs) {
      return res.json({ data: [] });
    }

    // Group services by category
    const svcsByCategory: Record<string, typeof svcs> = {};
    for (const svc of svcs) {
      if (!svc.category_id) continue;
      if (!svcsByCategory[svc.category_id]) svcsByCategory[svc.category_id] = [];
      svcsByCategory[svc.category_id].push(svc);
    }

    const result = cats
      .map((cat) => {
        const items = (svcsByCategory[cat.id] ?? []).map((s) => ({
          name: s.name,
          slug: s.slug,
          summary: s.summary ?? "",
          details: s.description ?? "",
          bestFor: (s as any).best_for as string ?? "",
          price: formatDisplayPrice(s.price),
          priceRaw: s.price ?? 0,
        }));
        return {
          title: cat.name,
          slug: cat.slug,
          description: cat.description ?? "",
          items,
        };
      })
      .filter((cat) => cat.items.length > 0);

    res.json({ data: result });
  } catch (error) {
    console.error('getServices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getServicePriceBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('services')
      .select('id, name, price')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error) return res.status(404).json({ error: 'Service not found' });
    res.json({ data });
  } catch (error) {
    console.error('getServicePriceBySlug error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getServiceDocumentTemplates = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const supabase = createServiceClient();

    // 1. Resolve slug to id
    const { data: svcRow } = await supabase
      .from('services')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (!svcRow?.id) return res.json({ data: [] });

    // 2. config-driven requirements
    const { data: reqs, error: reqErr } = await supabase
      .from('service_document_requirements')
      .select('id, is_required, sort_order, document_type:document_types(id, name, description)')
      .eq('service_id', svcRow.id)
      .order('sort_order');

    if (!reqErr && reqs && reqs.length > 0) {
      const parsed = reqs.filter(r => r.document_type).map(r => {
        const dt = Array.isArray(r.document_type) ? r.document_type[0] : r.document_type;
        return {
          id: r.id,
          name: (dt as any).name,
          required: r.is_required,
          description: (dt as any).description ?? null,
        };
      });
      return res.json({ data: parsed });
    }

    // 3. Fallback to legacy
    const { data, error } = await supabase
      .from('services')
      .select('id, document_templates(id, name, description, required, sort_order)')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error || !data) return res.json({ data: [] });
    
    const templates = (data.document_templates ?? []) as any[];
    const parsedTemplates = templates.sort((a, b) => a.sort_order - b.sort_order).map(t => ({
      ...t,
      description: t.description ?? null,
    }));
    
    res.json({ data: parsedTemplates });
  } catch (error) {
    console.error('getServiceDocumentTemplates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
