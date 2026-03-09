import { Types } from 'mongoose';
import { payoutRepository } from './payout.repository';
import { User } from '../../../models/user.model';
import { payoutAccountService } from '../../payoutAccounts/payoutAccount.service';

const DEFAULT_CURRENCY = (process.env.DEFAULT_CURRENCY || 'usd').toLowerCase();

const toUpperPayeeType = (value: string) =>
  String(value || '').toUpperCase() === 'SCHOOL' ? 'SCHOOL' : 'TEACHER';

const createHttpError = (message: string, statusCode = 400) => {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const centsToDollars = (value: any) => Number((Number(value || 0) / 100).toFixed(2));

const pdfSafeText = (value: any) =>
  String(value ?? '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

const pdfText = (x: number, y: number, text: string, fontSize = 10, font: 'F1' | 'F2' = 'F1') =>
  `BT /${font} ${fontSize} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfSafeText(text)}) Tj ET`;

const pdfLine = (x1: number, y1: number, x2: number, y2: number) =>
  `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;

const pdfFillRect = (x: number, y: number, w: number, h: number, gray: number) =>
  `q ${gray.toFixed(3)} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`;

const pdfStrokeRect = (x: number, y: number, w: number, h: number) =>
  `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`;

const buildPayoutPdf = (input: {
  payoutId: string;
  generatedAt: Date;
  status: string;
  payeeName: string;
  payeeType: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  grossAmount: number;
  platformFeeAmount: number;
  netAmount: number;
  paymentRef?: string;
  paidAt?: Date | null;
  lineItems: Array<{ reference: string; gross: number; fee: number; net: number }>;
}) => {
  const pageWidth = 612;
  const pageHeight = 842;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const tableX = margin;
  const tableWidth = contentWidth;
  const rowHeight = 18;
  const headerRowHeight = 20;
  const rowsPerPage = 20;

  const fmtMoney = (amountInCents: number) => {
    const dollars = centsToDollars(amountInCents);
    return `${String(input.currency || 'USD').toUpperCase()} ${dollars.toFixed(2)}`;
  };
  const fmtDate = (value?: Date | null) =>
    value ? new Date(value).toISOString().slice(0, 10) : '-';

  const rows = input.lineItems.map((item, idx) => ({
    sr: String(idx + 1),
    ref: String(item.reference || '-').slice(0, 36),
    gross: fmtMoney(item.gross),
    fee: fmtMoney(item.fee),
    net: fmtMoney(item.net)
  }));

  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

  const kidIds: number[] = [];
  const contentObjectIds: number[] = [];
  const basePageObjectId = 3;
  const baseContentObjectId = 3 + pageCount;
  for (let i = 0; i < pageCount; i += 1) {
    kidIds.push(basePageObjectId + i);
    contentObjectIds.push(baseContentObjectId + i);
  }
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${kidIds.map(id => `${id} 0 R`).join(' ')}] >>`;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageNo = pageIndex + 1;
    const commands: string[] = [];

    commands.push(pdfFillRect(margin, 756, contentWidth, 44, 0.93));
    commands.push(pdfStrokeRect(margin, 756, contentWidth, 44));
    commands.push(pdfText(margin + 12, 783, 'HelloK12 Manual Payout Report', 15, 'F2'));
    commands.push(pdfText(pageWidth - margin - 90, 783, `Page ${pageNo}/${pageCount}`, 10, 'F1'));
    commands.push(pdfText(margin + 12, 766, `Payout ID: ${input.payoutId}`, 10, 'F1'));

    if (pageIndex === 0) {
      const leftX = margin + 10;
      const rightX = margin + 290;
      let y = 736;
      commands.push(pdfText(leftX, y, `Status: ${input.status}`, 10, 'F2'));
      commands.push(pdfText(rightX, y, `Payee Type: ${input.payeeType}`, 10, 'F2'));
      y -= 16;
      commands.push(pdfText(leftX, y, `Payee: ${input.payeeName}`, 10, 'F1'));
      commands.push(
        pdfText(
          rightX,
          y,
          `Period: ${fmtDate(input.periodStart)} to ${fmtDate(input.periodEnd)}`,
          10,
          'F1'
        )
      );
      y -= 16;
      commands.push(pdfText(leftX, y, `Payment Ref: ${input.paymentRef || '-'}`, 10, 'F1'));
      commands.push(pdfText(rightX, y, `Paid At: ${fmtDate(input.paidAt)}`, 10, 'F1'));

      const totalsY = y - 70;
      commands.push(pdfFillRect(margin, totalsY, contentWidth, 56, 0.96));
      commands.push(pdfStrokeRect(margin, totalsY, contentWidth, 56));
      commands.push(
        pdfText(margin + 10, totalsY + 38, `Gross Amount: ${fmtMoney(input.grossAmount)}`, 11, 'F2')
      );
      commands.push(
        pdfText(
          margin + 200,
          totalsY + 38,
          `Platform Fee: ${fmtMoney(input.platformFeeAmount)}`,
          11,
          'F2'
        )
      );
      commands.push(
        pdfText(margin + 390, totalsY + 38, `Net Payout: ${fmtMoney(input.netAmount)}`, 11, 'F2')
      );
    }

    const tableTopY = pageIndex === 0 ? 624 : 744;
    const cols = [
      { title: '#', width: 36, key: 'sr' as const, align: 'left' as const },
      { title: 'Reference', width: 216, key: 'ref' as const, align: 'left' as const },
      { title: 'Gross', width: 90, key: 'gross' as const, align: 'right' as const },
      { title: 'Fee', width: 90, key: 'fee' as const, align: 'right' as const },
      { title: 'Net', width: 100, key: 'net' as const, align: 'right' as const }
    ];

    commands.push(
      pdfFillRect(tableX, tableTopY - headerRowHeight, tableWidth, headerRowHeight, 0.9)
    );
    commands.push(pdfStrokeRect(tableX, tableTopY - headerRowHeight, tableWidth, headerRowHeight));
    commands.push(pdfLine(tableX, tableTopY, tableX + tableWidth, tableTopY));
    commands.push(
      pdfLine(tableX, tableTopY - headerRowHeight, tableX + tableWidth, tableTopY - headerRowHeight)
    );

    let cx = tableX;
    cols.forEach((c, idx) => {
      if (idx > 0) commands.push(pdfLine(cx, tableTopY, cx, tableTopY - headerRowHeight));
      commands.push(pdfText(cx + 4, tableTopY - 14, c.title, 9, 'F2'));
      cx += c.width;
    });
    commands.push(
      pdfLine(tableX + tableWidth, tableTopY, tableX + tableWidth, tableTopY - headerRowHeight)
    );

    const start = pageIndex * rowsPerPage;
    const end = Math.min(start + rowsPerPage, rows.length);
    const pageRows = rows.slice(start, end);
    let rowTop = tableTopY - headerRowHeight;

    pageRows.forEach((row, idx) => {
      const rowBottom = rowTop - rowHeight;
      if (idx % 2 === 1) {
        commands.push(pdfFillRect(tableX, rowBottom, tableWidth, rowHeight, 0.97));
      }
      commands.push(pdfStrokeRect(tableX, rowBottom, tableWidth, rowHeight));
      let x = tableX;
      cols.forEach(c => {
        const text = String(row[c.key] || '');
        if (c.align === 'right') {
          const textW = text.length * 4.6;
          commands.push(pdfText(x + c.width - 6 - textW, rowBottom + 6, text, 9, 'F1'));
        } else {
          commands.push(pdfText(x + 4, rowBottom + 6, text, 9, 'F1'));
        }
        commands.push(pdfLine(x, rowTop, x, rowBottom));
        x += c.width;
      });
      commands.push(pdfLine(tableX + tableWidth, rowTop, tableX + tableWidth, rowBottom));
      rowTop = rowBottom;
    });

    if (!rows.length && pageIndex === 0) {
      const noDataY = tableTopY - headerRowHeight - rowHeight;
      commands.push(pdfStrokeRect(tableX, noDataY, tableWidth, rowHeight));
      commands.push(
        pdfText(tableX + 8, noDataY + 6, 'No line items available for this payout.', 9, 'F1')
      );
    }

    commands.push(pdfLine(margin, 48, pageWidth - margin, 48));
    commands.push(
      pdfText(
        margin,
        34,
        `Generated at: ${input.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
        8,
        'F1'
      )
    );
    commands.push(
      pdfText(pageWidth - margin - 220, 34, `HelloK12 Finance • Confidential`, 8, 'F1')
    );

    const stream = commands.join('\n');
    objects[basePageObjectId + pageIndex] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 ${baseContentObjectId + pageCount} 0 R /F2 ${baseContentObjectId + pageCount + 1} 0 R >> >> ` +
      `/Contents ${baseContentObjectId + pageIndex} 0 R >>`;
    objects[baseContentObjectId + pageIndex] =
      `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
  }

  const fontRegularId = baseContentObjectId + pageCount;
  const fontBoldId = fontRegularId + 1;
  objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i += 1) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < objects.length; i += 1) {
    const off = offsets[i] || 0;
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
};

const normalizeAdjustments = (
  adjustments: Array<{ type: string; amount: number; note?: string }> = []
) =>
  (adjustments || []).map(adj => ({
    type: String(adj.type || '').trim(),
    amount: Number(adj.amount || 0),
    note: String(adj.note || '').trim()
  }));

const normalizePeriod = (start: Date, end: Date) => {
  const periodStart = new Date(start);
  periodStart.setHours(0, 0, 0, 0);

  const periodEnd = new Date(end);
  periodEnd.setHours(23, 59, 59, 999);

  return { periodStart, periodEnd };
};

const toObjectIdOrNull = (value?: any) => {
  const s = String(value || '').trim();
  if (!s || !Types.ObjectId.isValid(s)) return null;
  return new Types.ObjectId(s);
};

const getEntityIdString = (value: any): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const v = value.trim();
    return Types.ObjectId.isValid(v) ? v : null;
  }

  if (value instanceof Types.ObjectId) {
    return String(value);
  }

  if (typeof value === 'object' && value._id) {
    const nested = String(value._id).trim();
    return Types.ObjectId.isValid(nested) ? nested : null;
  }

  const raw = String(value).trim();
  return Types.ObjectId.isValid(raw) ? raw : null;
};

const ensurePayeeRole = async (payeeType: 'TEACHER' | 'SCHOOL', payeeId: string) => {
  const user = await User.findById(payeeId).select('_id role name email school').lean();
  if (!user?._id) throw createHttpError('Payee not found', 404);

  if (payeeType === 'TEACHER') {
    if (String(user.role) !== 'teacher') throw createHttpError('Payee must be a teacher user', 400);
    if (user.school) {
      throw createHttpError(
        'School-linked teachers are paid through school payouts. Use payeeType=SCHOOL.',
        400
      );
    }
  }

  if (payeeType === 'SCHOOL' && String(user.role) !== 'school') {
    throw createHttpError('Payee must be a school user', 400);
  }

  return {
    _id: String(user._id),
    role: String(user.role || ''),
    name: String(user.name || ''),
    email: String(user.email || '')
  };
};

export const payoutService = {
  async previewPayout(input: {
    payeeType: 'TEACHER' | 'SCHOOL';
    payeeId: string;
    periodStart: Date;
    periodEnd: Date;
    adjustments?: Array<{ type: string; amount: number; note?: string }>;
    currency?: string;
  }) {
    const payeeType = toUpperPayeeType(input.payeeType);
    await ensurePayeeRole(payeeType, input.payeeId);

    const { periodStart, periodEnd } = normalizePeriod(input.periodStart, input.periodEnd);
    if (periodEnd < periodStart) {
      throw createHttpError('periodEnd must be greater than or equal to periodStart', 400);
    }

    const txRows = await payoutRepository.findSettledTransactionsForPayee({
      payeeType,
      payeeId: input.payeeId,
      periodStart,
      periodEnd
    });

    const filteredForPaidAndNonTrial = txRows.filter((tx: any) => {
      const booking = tx?.booking;
      if (!booking) return true;
      if (booking.isTrial) return false;
      return String(booking.paymentStatus || '') === 'PAID';
    });

    const txIds = filteredForPaidAndNonTrial
      .map((tx: any) => String(tx?._id || ''))
      .filter((v: string) => Types.ObjectId.isValid(v));

    const usedTxIds = await payoutRepository.findTransactionIdsAlreadyUsedInManualPayouts(txIds);

    const eligibleRows = filteredForPaidAndNonTrial.filter(
      (tx: any) => !usedTxIds.has(String(tx._id))
    );

    const lineItems = eligibleRows.map((tx: any) => ({
      transactionId: tx._id,
      bookingId: toObjectIdOrNull(tx?.booking?._id),
      courseId: toObjectIdOrNull(tx?.booking?.course?._id),
      amount: Number(tx.amount || 0),
      platformFee: Number(tx.platformFee || 0),
      netAmount: Number(tx.netAmount || Number(tx.amount || 0) - Number(tx.platformFee || 0)),
      transactionDate: tx.createdAt,
      reference: String(
        tx.reference || tx.metadata?.invoiceId || tx.metadata?.paymentIntentId || ''
      )
    }));

    const grossAmount = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const platformFeeAmount = lineItems.reduce(
      (sum, item) => sum + Number(item.platformFee || 0),
      0
    );

    const normalizedAdjustments = normalizeAdjustments(input.adjustments || []);
    const adjustmentTotal = normalizedAdjustments.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const baseNet = lineItems.reduce((sum, item) => sum + Number(item.netAmount || 0), 0);
    const netAmount = baseNet + adjustmentTotal;

    const payoutAccountSummary = await payoutAccountService.getByOwnerForPayout(
      payeeType,
      input.payeeId
    );

    return {
      payeeType,
      payeeId: input.payeeId,
      periodStart,
      periodEnd,
      currency: String(input.currency || DEFAULT_CURRENCY).toLowerCase(),
      grossAmount,
      platformFeeAmount,
      netAmount,
      adjustmentTotal,
      adjustments: normalizedAdjustments,
      lineItems,
      payoutAccountSummary,
      lineItemsSummary: {
        count: lineItems.length,
        transactionIds: lineItems.map(item => String(item.transactionId))
      }
    };
  },

  async createPayout(input: {
    payeeType: 'TEACHER' | 'SCHOOL';
    payeeId: string;
    periodStart: Date;
    periodEnd: Date;
    adjustments?: Array<{ type: string; amount: number; note?: string }>;
    currency?: string;
    createdBy: string;
  }) {
    const payeeType = toUpperPayeeType(input.payeeType);
    await ensurePayeeRole(payeeType, input.payeeId);

    const { periodStart, periodEnd } = normalizePeriod(input.periodStart, input.periodEnd);

    const overlap = await payoutRepository.findBlockingPayoutOverlap({
      payeeType,
      payeeId: input.payeeId,
      periodStart,
      periodEnd
    });

    if (overlap?._id) {
      throw createHttpError('This period overlaps an approved/paid payout for the same payee', 409);
    }

    const existingExact = await payoutRepository.findManualPayoutByExactPeriod({
      payeeType,
      payeeId: input.payeeId,
      periodStart,
      periodEnd
    });

    const preview = await this.previewPayout({
      payeeType,
      payeeId: input.payeeId,
      periodStart,
      periodEnd,
      adjustments: input.adjustments,
      currency: input.currency
    });

    if (existingExact?._id) {
      if (existingExact.status !== 'CANCELLED') {
        throw createHttpError('A payout already exists for this payee and period', 409);
      }

      const replaced = await payoutRepository.replaceCancelledPayout(String(existingExact._id), {
        payeeType,
        payeeId: new Types.ObjectId(input.payeeId),
        periodStart: preview.periodStart,
        periodEnd: preview.periodEnd,
        currency: preview.currency,
        amount: preview.grossAmount,
        grossAmount: preview.grossAmount,
        platformFee: preview.platformFeeAmount,
        netAmount: preview.netAmount,
        adjustments: preview.adjustments,
        lineItems: preview.lineItems,
        metadata: {
          createdBy: input.createdBy,
          recreatedFromCancelled: true,
          lineItemsSummary: preview.lineItemsSummary
        }
      });

      if (!replaced?._id) {
        throw createHttpError('Failed to recreate cancelled payout', 409);
      }
      return replaced;
    }

    const payout = await payoutRepository.createManualPayout({
      payoutKind: 'MANUAL',
      payeeType,
      payeeId: new Types.ObjectId(input.payeeId),
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      currency: preview.currency,
      amount: preview.grossAmount,
      grossAmount: preview.grossAmount,
      platformFee: preview.platformFeeAmount,
      netAmount: preview.netAmount,
      adjustments: preview.adjustments,
      status: 'DRAFT',
      lineItems: preview.lineItems,
      metadata: {
        createdBy: input.createdBy,
        lineItemsSummary: preview.lineItemsSummary
      }
    });

    return payoutRepository.getManualPayoutById(String((payout as any)._id));
  },

  async listPayouts(filters: {
    page: number;
    limit: number;
    search?: string;
    payeeType?: 'TEACHER' | 'SCHOOL';
    payeeId?: string;
    status?: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
    from?: Date;
    to?: Date;
  }) {
    return payoutRepository.listManualPayouts(filters);
  },

  async getPayoutById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout id', 400);
    const payout = await payoutRepository.getManualPayoutById(id);
    if (!payout) throw createHttpError('Payout not found', 404);
    const payeeId = getEntityIdString((payout as any).payeeId);
    const payoutAccountSummary = payeeId
      ? await payoutAccountService.getByOwnerForPayout((payout as any).payeeType, payeeId)
      : null;
    return {
      ...payout,
      payoutAccountSummary
    };
  },

  async approvePayout(id: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout id', 400);

    const current = await payoutRepository.getManualPayoutById(id);
    if (!current) throw createHttpError('Payout not found', 404);

    const resolvedPayeeId = getEntityIdString(current.payeeId);
    if (!resolvedPayeeId) {
      throw createHttpError('Invalid payout payeeId', 409);
    }

    const overlap = await payoutRepository.findBlockingPayoutOverlap({
      payeeType: current.payeeType as 'TEACHER' | 'SCHOOL',
      payeeId: resolvedPayeeId,
      periodStart: new Date(current.periodStart as any),
      periodEnd: new Date(current.periodEnd as any),
      excludePayoutId: String(current._id)
    });
    if (overlap?._id) {
      throw createHttpError(
        'Cannot approve because this period overlaps an approved/paid payout',
        409
      );
    }

    const payout = await payoutRepository.approvePayout(id);
    if (!payout) throw createHttpError('Only DRAFT payouts can be approved', 409);
    return payout;
  },

  async markPaid(
    id: string,
    input: { paymentRef: string; paidAt?: Date; note?: string; paidBy: string }
  ) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout id', 400);

    const current = await payoutRepository.getManualPayoutById(id);
    if (!current) throw createHttpError('Payout not found', 404);
    const payeeId = getEntityIdString((current as any).payeeId);
    if (!payeeId) throw createHttpError('Invalid payout payeeId', 409);

    const payoutAccountSummary = await payoutAccountService.getByOwnerForPayout(
      (current as any).payeeType,
      payeeId
    );
    if (!payoutAccountSummary) throw createHttpError('No payout account found for payee', 409);
    if (String(payoutAccountSummary.status || '') !== 'VERIFIED') {
      throw createHttpError('Payout account must be VERIFIED before marking payout paid', 409);
    }

    const payout = await payoutRepository.markPaid(id, {
      paymentRef: input.paymentRef,
      paidAt: input.paidAt || new Date(),
      paidBy: input.paidBy,
      note: input.note
    });

    if (!payout) throw createHttpError('Only APPROVED payouts can be marked as paid', 409);
    return payout;
  },

  async cancelPayout(id: string, note?: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout id', 400);
    const payout = await payoutRepository.cancelPayout(id, note);
    if (!payout) throw createHttpError('Only DRAFT/APPROVED payouts can be cancelled', 409);
    return payout;
  },

  async getPayoutReportPdf(id: string) {
    const payout = await this.getPayoutById(id);

    const payeeName = String(
      (payout as any)?.payeeId?.name || (payout as any)?.payeeId?.email || 'Unknown'
    );
    const lineItems = (((payout as any)?.lineItems || []) as Array<any>).map(item => ({
      reference: String(item?.reference || item?.transactionId || '-'),
      gross: Number(item?.amount || 0),
      fee: Number(item?.platformFee || 0),
      net: Number(item?.netAmount || 0)
    }));

    const fileName = `payout-${String((payout as any)?._id || '').slice(-8)}.pdf`;
    return {
      buffer: buildPayoutPdf({
        payoutId: String((payout as any)?._id || ''),
        generatedAt: new Date(),
        status: String((payout as any)?.status || ''),
        payeeName,
        payeeType: String((payout as any)?.payeeType || ''),
        periodStart: new Date((payout as any)?.periodStart),
        periodEnd: new Date((payout as any)?.periodEnd),
        currency: String((payout as any)?.currency || DEFAULT_CURRENCY || 'usd'),
        grossAmount: Number((payout as any)?.grossAmount || (payout as any)?.amount || 0),
        platformFeeAmount: Number((payout as any)?.platformFee || 0),
        netAmount: Number((payout as any)?.netAmount || 0),
        paymentRef: String((payout as any)?.paymentRef || ''),
        paidAt: (payout as any)?.paidAt ? new Date((payout as any)?.paidAt) : null,
        lineItems
      }),
      fileName
    };
  }
};
