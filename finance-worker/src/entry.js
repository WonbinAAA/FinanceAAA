import {WorkerEntrypoint} from 'cloudflare:workers';
import worker from './worker.js';
import {companyOptions,previewCompany,previewCompanyBatch,applyCompanyEvent,installCompanyBaseline} from './company-link.js';
export default worker;
// RPC-only: this class has no public fetch route or reusable browser credential.
export class CompanyFinance extends WorkerEntrypoint {
  options(ownerId){return companyOptions(this.env,ownerId);}
  preview(ownerId,entry,strict=false){return previewCompany(this.env,ownerId,entry,strict);}
  previewBatch(ownerId,entries,strict=false){return previewCompanyBatch(this.env,ownerId,entries,strict);}
  apply(event){return applyCompanyEvent(this.env,event);}
  baseline(ownerId,plan){return installCompanyBaseline(this.env,ownerId,plan);}
}
