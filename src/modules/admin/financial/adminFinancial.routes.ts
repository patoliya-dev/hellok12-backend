import { Router } from 'express';
import { adminFinancialController } from './adminFinancial.controller';

const router = Router();

router.get('/summary', adminFinancialController.getSummary);

router.get('/trend', adminFinancialController.getTrend);

router.get('/payouts', adminFinancialController.listPayouts);

router.get('/revenue', adminFinancialController.listRevenue);
router.get('/revenue/:courseId/download', adminFinancialController.downloadRevenueReport);

router.get('/commission', adminFinancialController.listCommission);
router.get('/commission/:courseId/download', adminFinancialController.downloadCommissionReport);

export default router;
