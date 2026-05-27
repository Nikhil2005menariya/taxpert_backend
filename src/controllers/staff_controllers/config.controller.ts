import { Request, Response } from 'express';
import { createServiceClient } from '../../configs/supabase.config';
import { isAdminRole, UserRole } from '../../shared/roles';

export const getServiceCategories = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase.from('service_categories').select('*').order('sort_order');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getServiceCategories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const upsertServiceCategory = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const input = req.body;
    const payload = {
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase().replace(/\s+/g, '-'),
      description: input.description ?? null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    };

    let result;
    if (input.id) {
      result = await req.supabase.from('service_categories').update(payload).eq('id', input.id).select().single();
    } else {
      result = await req.supabase.from('service_categories').insert(payload).select().single();
    }

    if (result.error) return res.status(400).json({ error: result.error.message });
    res.json({ data: result.data });
  } catch (error) {
    console.error('upsertServiceCategory error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const toggleCategoryActive = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const { is_active } = req.body;

    const { error } = await req.supabase.from('service_categories').update({ is_active }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('toggleCategoryActive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getServicesConfig = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase
      .from('services')
      .select(`
        id, slug, name, category, category_id, description, summary,
        price, is_active, requires_fy, sort_order, created_by, created_at,
        service_category:service_categories(id, name, slug)
      `)
      .order('sort_order');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getServicesConfig error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getServiceConfigById = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;

    const { data, error } = await req.supabase
      .from('services')
      .select(`
        id, slug, name, category, category_id, description, summary,
        price, is_active, requires_fy, sort_order, created_by, created_at,
        service_category:service_categories(id, name, slug),
        service_document_requirements(
          id, service_id, document_type_id, is_required, is_optional,
          requires_fy, sort_order, created_at,
          document_type:document_types(id, code, name, description, is_common_document, allowed_extensions, max_file_size_mb)
        ),
        service_due_date_templates(
          id, service_id, title, description, recurrence_type,
          applicable_month, applicable_day, applicable_quarter_months, is_active, created_at
        )
      `)
      .eq('id', id)
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getServiceConfigById error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createService = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const input = req.body;
    const { data, error } = await req.supabase
      .from('services')
      .insert({
        name: input.name.trim(),
        slug: input.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        category: input.category.trim(),
        category_id: input.category_id ?? null,
        description: input.description ?? null,
        summary: input.summary ?? null,
        price: input.price,
        is_active: true,
        requires_fy: input.requires_fy ?? false,
        sort_order: input.sort_order ?? 0,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('createService error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateService = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const input = req.body;
    
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.slug !== undefined) payload.slug = input.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (input.category !== undefined) payload.category = input.category.trim();
    if (input.category_id !== undefined) payload.category_id = input.category_id;
    if (input.description !== undefined) payload.description = input.description;
    if (input.summary !== undefined) payload.summary = input.summary;
    if (input.price !== undefined) payload.price = input.price;
    if (input.is_active !== undefined) payload.is_active = input.is_active;
    if (input.requires_fy !== undefined) payload.requires_fy = input.requires_fy;
    if (input.sort_order !== undefined) payload.sort_order = input.sort_order;

    const { error } = await req.supabase.from('services').update(payload).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('updateService error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const toggleServiceActive = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const { is_active } = req.body;

    const { error } = await req.supabase.from('services').update({ is_active }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('toggleServiceActive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Document Types
export const getDocumentTypes = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await req.supabase.from('document_types').select('*').order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getDocumentTypes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const upsertDocumentType = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });

    const input = req.body;
    const payload = {
      code: input.code.trim().toUpperCase().replace(/\s+/g, '_'),
      name: input.name.trim(),
      description: input.description ?? null,
      is_common_document: input.is_common_document ?? false,
      allowed_extensions: input.allowed_extensions ?? ['pdf', 'jpg', 'jpeg', 'png'],
      max_file_size_mb: input.max_file_size_mb ?? 10,
      is_active: input.is_active ?? true,
    };

    let result;
    if (input.id) {
      result = await req.supabase.from('document_types').update(payload).eq('id', input.id).select().single();
    } else {
      result = await req.supabase.from('document_types').insert(payload).select().single();
    }

    if (result.error) return res.status(400).json({ error: result.error.message });
    res.json({ data: result.data });
  } catch (error) {
    console.error('upsertDocumentType error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Service Document Requirements
export const getServiceDocumentRequirements = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { serviceId } = req.params;

    const { data, error } = await req.supabase
      .from('service_document_requirements')
      .select(`
        id, service_id, document_type_id, is_required, is_optional, requires_fy, sort_order, created_at,
        document_type:document_types(id, code, name, description, is_common_document, allowed_extensions, max_file_size_mb)
      `)
      .eq('service_id', serviceId)
      .order('sort_order');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getServiceDocumentRequirements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addDocumentRequirement = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const input = req.body;
    const { error } = await req.supabase.from('service_document_requirements').insert({
      service_id: input.service_id,
      document_type_id: input.document_type_id,
      is_required: input.is_required,
      is_optional: input.is_optional,
      requires_fy: input.requires_fy ?? false,
      sort_order: input.sort_order ?? 0,
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('addDocumentRequirement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateDocumentRequirement = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const input = req.body;

    const { error } = await req.supabase.from('service_document_requirements').update(input).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('updateDocumentRequirement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeDocumentRequirement = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const { error } = await req.supabase.from('service_document_requirements').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('removeDocumentRequirement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Due date templates
export const getServiceDueDateTemplates = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { serviceId } = req.params;

    const { data, error } = await req.supabase
      .from('service_due_date_templates')
      .select('*')
      .eq('service_id', serviceId)
      .order('applicable_month', { nullsFirst: true })
      .order('applicable_day');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getServiceDueDateTemplates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const upsertDueDateTemplate = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const input = req.body;
    const payload = {
      service_id: input.service_id,
      title: input.title.trim(),
      description: input.description ?? null,
      recurrence_type: input.recurrence_type,
      applicable_month: input.applicable_month ?? null,
      applicable_day: input.applicable_day,
      is_active: input.is_active ?? true,
    };

    let result;
    if (input.id) {
      result = await req.supabase.from('service_due_date_templates').update(payload).eq('id', input.id).select().single();
    } else {
      result = await req.supabase.from('service_due_date_templates').insert(payload).select().single();
    }

    if (result.error) return res.status(400).json({ error: result.error.message });
    res.json({ data: result.data });
  } catch (error) {
    console.error('upsertDueDateTemplate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeDueDateTemplate = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await req.supabase.from('users').select('role').eq('id', req.user.id).single();
    if (!isAdminRole(profile?.role as UserRole)) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.params;
    const { error } = await req.supabase.from('service_due_date_templates').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('removeDueDateTemplate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const computeDueDatesFromDB = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { serviceId } = req.params;
    const windowMonths = req.query.windowMonths ? parseInt(req.query.windowMonths as string) : 6;

    const { data: templates } = await req.supabase
      .from('service_due_date_templates')
      .select('*')
      .eq('service_id', serviceId)
      .eq('is_active', true);

    if (!templates || templates.length === 0) return res.json({ data: [] });

    const now = new Date();
    const results: Array<{ id: string; label: string; description: string; date: Date; sourceKey: string }> = [];

    for (const tpl of templates as any[]) {
      if (tpl.recurrence_type === 'monthly') {
        for (let i = 0; i < windowMonths; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() + i, tpl.applicable_day);
          if (d >= new Date(now.getFullYear(), now.getMonth() - 1, 1)) {
            const key = `${serviceId}-${tpl.id}-${d.getFullYear()}-${d.getMonth()}`;
            results.push({ id: key, label: tpl.title, description: tpl.description ?? '', date: d, sourceKey: key });
          }
        }
      } else {
        for (const yr of [now.getFullYear(), now.getFullYear() + 1]) {
          const m = tpl.applicable_month ?? 1;
          const d = new Date(yr, m - 1, tpl.applicable_day);
          const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          if (d >= cutoff) {
            const key = `${serviceId}-${tpl.id}-${yr}`;
            results.push({ id: key, label: tpl.title, description: tpl.description ?? '', date: d, sourceKey: key });
            break;
          }
        }
      }
    }

    const sortedResults = results.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 8);
    res.json({ data: sortedResults });
  } catch (error) {
    console.error('computeDueDatesFromDB error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getRequiredDocTypesForService = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.supabase) return res.status(401).json({ error: 'Unauthorized' });
    const { serviceId } = req.params;

    const { data, error } = await req.supabase
      .from('service_document_requirements')
      .select(`
        is_required, is_optional, sort_order,
        document_type:document_types(id, code, name, description, max_file_size_mb, allowed_extensions)
      `)
      .eq('service_id', serviceId)
      .eq('is_required', true)
      .order('sort_order');

    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (error) {
    console.error('getRequiredDocTypesForService error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
