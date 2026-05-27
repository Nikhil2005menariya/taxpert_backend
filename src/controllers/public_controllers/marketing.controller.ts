import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';

interface MarketingServiceItem {
  name: string;
  slug: string;
  summary: string;
  details: string;
  bestFor: string;
  price: string | null;
  priceRaw: number;
}

interface MarketingCategory {
  title: string;
  slug: string;
  description: string;
  items: MarketingServiceItem[];
}

function formatDisplayPrice(paise: number | null): string | null {
  if (!paise || paise === 0) return null;
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

async function fetchCategories(): Promise<{ data: MarketingCategory[]; source: 'db' | 'empty' }> {
  const supabase = createServiceClient();

  const { data: cats, error: catErr } = await supabase
    .from('service_categories')
    .select('id, name, slug, description')
    .eq('is_active', true)
    .order('sort_order');

  if (catErr || !cats || cats.length === 0) {
    return { data: [], source: 'empty' };
  }

  const { data: svcs, error: svcErr } = await supabase
    .from('services')
    .select('id, name, slug, summary, description, best_for, price, category_id, sort_order')
    .eq('is_active', true)
    .order('sort_order');

  if (svcErr || !svcs) {
    return { data: [], source: 'empty' };
  }

  const svcsByCategory: Record<string, typeof svcs> = {};
  for (const svc of svcs) {
    if (!svc.category_id) continue;
    if (!svcsByCategory[svc.category_id]) svcsByCategory[svc.category_id] = [];
    svcsByCategory[svc.category_id].push(svc);
  }

  const result: MarketingCategory[] = cats
    .map((cat) => {
      const items = (svcsByCategory[cat.id] ?? []).map((s) => ({
        name: s.name,
        slug: s.slug,
        summary: s.summary ?? '',
        details: (s as Record<string, unknown>).description as string ?? '',
        bestFor: (s as Record<string, unknown>).best_for as string ?? '',
        price: formatDisplayPrice(s.price),
        priceRaw: s.price ?? 0,
      }));
      return {
        title: cat.name,
        slug: cat.slug,
        description: (cat as Record<string, unknown>).description as string ?? '',
        items,
      };
    })
    .filter((cat) => cat.items.length > 0);

  return { data: result, source: 'db' };
}

export const getMarketingCategories = async (_req: Request, res: Response) => {
  try {
    const result = await fetchCategories();
    res.json(result);
  } catch (error) {
    console.error('getMarketingCategories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMarketingCategoryBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { data: categories } = await fetchCategories();
    const category = categories.find((c) => c.slug === slug) ?? null;
    res.json({ category });
  } catch (error) {
    console.error('getMarketingCategoryBySlug error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getMarketingServiceBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('services')
      .select('id, name, slug, summary, description, best_for, price, category_id, service_categories(slug)')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return res.json({ service: null, categorySlug: null });
    }

    const catSlug = Array.isArray(data.service_categories)
      ? (data.service_categories[0] as { slug: string } | undefined)?.slug ?? null
      : (data.service_categories as { slug: string } | null)?.slug ?? null;

    res.json({
      service: {
        name: data.name,
        slug: data.slug,
        summary: data.summary ?? '',
        details: (data as Record<string, unknown>).description as string ?? '',
        bestFor: (data as Record<string, unknown>).best_for as string ?? '',
        price: formatDisplayPrice(data.price),
        priceRaw: data.price ?? 0,
      },
      categorySlug: catSlug,
    });
  } catch (error) {
    console.error('getMarketingServiceBySlug error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
