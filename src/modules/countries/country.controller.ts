import type { Request, Response } from 'express';

import type { CountryService } from './country.service.js';

export class CountryController {
  constructor(
    private readonly service: CountryService,
  ) {}

  getSupportedCountries = async (
    _req: Request,
    res: Response,
  ) => {
    const countries =
      await this.service.getSupportedCountries();

    return res.status(200).json({
      success: true,
      message: null,
      data: countries,
    });
  };
}