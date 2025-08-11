import { Router } from 'express';
import { register, login } from "../controllers/auth.controller";

const router = Router();

router.post('/register', (req, res, next) => {
    console.log('Register route hit', req.body);
    next();
  }, register);
router.post('/login', login);

export default router;
