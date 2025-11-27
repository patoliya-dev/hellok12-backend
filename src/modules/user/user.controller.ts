// src/modules/parents/parents.controller.ts
import { Request, Response, NextFunction } from 'express';
import { User } from '../../models/user.model';

export async function getParentStudents(req: Request, res: Response, next: NextFunction) {
  try {
    const parentId = req.params.parentId;
    if (!parentId) return res.status(400).send({ error: 'parentId required' });

    // Ensure caller has rights — parent or admin. Minimal: authenticated user must be same parent or admin.
    const callerId = (req as any).user?.id;
    if (!callerId) return res.status(401).send({ error: 'Unauthorized' });

    // If caller is not admin and not the parent requested, deny
    const caller = await User.findById(callerId);
    if (caller?.role !== 'parent' && caller?.role !== 'school' && callerId !== parentId) {
      return res.status(403).send({ error: 'Forbidden' });
    }

    // Fetch children: users whose parent == parentId
    const children = await User.find({ parent: parentId }).select(
      '_id name email profile age phone role'
    );
    res.json({ success: true, data: children });
  } catch (err) {
    next(err);
  }
}
