import crypto from "node:crypto";

import bcrypt from "bcrypt";

import { TSecretSharing } from "@app/db/schemas";
import { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { getConfig } from "@app/lib/config/env";
import { BadRequestError, ForbiddenRequestError, NotFoundError, UnauthorizedError } from "@app/lib/errors";
import { SecretSharingAccessType } from "@app/lib/types";
import { isUuidV4 } from "@app/lib/validator";

import { TKmsServiceFactory } from "../kms/kms-service";
import { TOrgDALFactory } from "../org/org-dal";
import { SmtpTemplates, TSmtpService } from "../smtp/smtp-service";
import { TUserDALFactory } from "../user/user-dal";
import { TSecretSharingDALFactory } from "./secret-sharing-dal";
import {
  SecretSharingType,
  TCreatePublicSharedSecretDTO,
  TCreateSecretRequestDTO,
  TCreateSharedSecretDTO,
  TDeleteSharedSecretDTO,
  TGetActiveSharedSecretByIdDTO,
  TGetSecretRequestByIdDTO,
  TGetSharedSecretsDTO,
  TRevealSecretRequestValueDTO,
  TSetSecretRequestValueDTO
} from "./secret-sharing-types";

type TSecretSharingServiceFactoryDep = {
  permissionService: Pick<TPermissionServiceFactory, "getOrgPermission">;
  secretSharingDAL: TSecretSharingDALFactory;
  orgDAL: TOrgDALFactory;
  userDAL: TUserDALFactory;
  kmsService: TKmsServiceFactory;
  smtpService: TSmtpService;
};

export type TSecretSharingServiceFactory = ReturnType<typeof secretSharingServiceFactory>;

export const secretSharingServiceFactory = ({
  permissionService,
  secretSharingDAL,
  orgDAL,
  kmsService,
  smtpService,
  userDAL
}: TSecretSharingServiceFactoryDep) => {
  const $validateSharedSecretExpiry = (expiresAt: string) => {
    if (new Date(expiresAt) < new Date()) {
      throw new BadRequestError({ message: "Expiration date cannot be in the past" });
    }

    // Limit Expiry Time to 1 month
    const expiryTime = new Date(expiresAt).getTime();
    const currentTime = new Date().getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (expiryTime - currentTime > thirtyDays) {
      throw new BadRequestError({ message: "Expiration date cannot be more than 30 days" });
    }

    const fiveMins = 5 * 60 * 1000;
    if (expiryTime - currentTime < fiveMins) {
      throw new BadRequestError({ message: "Expiration time cannot be less than 5 mins" });
    }
  };

  const createSharedSecret = async ({
    actor,
    actorId,
    orgId,
    actorAuthMethod,
    actorOrgId,
    secretValue,
    name,
    password,
    accessType,
    expiresAt,
    expiresAfterViews
  }: TCreateSharedSecretDTO) => {
    const { permission } = await permissionService.getOrgPermission(actor, actorId, orgId, actorAuthMethod, actorOrgId);
    if (!permission) throw new ForbiddenRequestError({ name: "User is not a part of the specified organization" });
    $validateSharedSecretExpiry(expiresAt);

    if (secretValue.length > 10_000) {
      throw new BadRequestError({ message: "Shared secret value too long" });
    }

    const encryptWithRoot = kmsService.encryptWithRootKey();
    const encryptedSecret = encryptWithRoot(Buffer.from(secretValue));

    const id = crypto.randomBytes(32).toString("hex");
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const newSharedSecret = await secretSharingDAL.create({
      identifier: id,
      iv: null,
      tag: null,
      encryptedValue: null,
      encryptedSecret,
      name,
      type: SecretSharingType.Share,
      password: hashedPassword,
      expiresAt: new Date(expiresAt),
      expiresAfterViews,
      userId: actorId,
      orgId,
      accessType
    });

    const idToReturn = `${Buffer.from(newSharedSecret.identifier!, "hex").toString("base64url")}`;

    return { id: idToReturn };
  };

  const createSecretRequest = async ({
    actor,
    accessType,
    expiresAt,
    name,
    actorId,
    orgId,
    actorAuthMethod,
    actorOrgId
  }: TCreateSecretRequestDTO) => {
    const { permission } = await permissionService.getOrgPermission(actor, actorId, orgId, actorAuthMethod, actorOrgId);
    if (!permission) throw new ForbiddenRequestError({ name: "User is not a part of the specified organization" });

    $validateSharedSecretExpiry(expiresAt);

    const newSecretRequest = await secretSharingDAL.create({
      type: SecretSharingType.Request,
      userId: actorId,
      orgId,
      name,
      encryptedSecret: null,
      accessType,
      expiresAt: new Date(expiresAt)
    });

    return { id: newSecretRequest.id };
  };

  const revealSecretRequestValue = async ({
    id,
    actor,
    actorId,
    actorOrgId,
    orgId,
    actorAuthMethod
  }: TRevealSecretRequestValueDTO) => {
    const secretRequest = await secretSharingDAL.getSecretRequestById(id);

    if (!secretRequest) {
      throw new NotFoundError({ message: `Secret request with ID '${id}' not found` });
    }

    const { permission } = await permissionService.getOrgPermission(actor, actorId, orgId, actorAuthMethod, actorOrgId);
    if (!permission) throw new ForbiddenRequestError({ name: "User is not a part of the specified organization" });

    if (secretRequest.userId !== actorId || secretRequest.orgId !== orgId) {
      throw new ForbiddenRequestError({ name: "User does not have permission to access this secret request" });
    }

    if (!secretRequest.encryptedSecret) {
      throw new BadRequestError({ message: "Secret request has no value set" });
    }

    const decryptWithRoot = kmsService.decryptWithRootKey();
    const decryptedSecret = decryptWithRoot(secretRequest.encryptedSecret);

    return { ...secretRequest, secretValue: decryptedSecret.toString() };
  };

  const getSecretRequestById = async ({
    id,
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId
  }: TGetSecretRequestByIdDTO) => {
    const secretRequest = await secretSharingDAL.getSecretRequestById(id);

    if (!secretRequest) {
      throw new NotFoundError({ message: `Secret request with ID '${id}' not found` });
    }

    if (secretRequest.accessType === SecretSharingAccessType.Organization) {
      if (!secretRequest.orgId) {
        throw new BadRequestError({ message: "No organization ID present on secret request" });
      }

      if (!actorOrgId) {
        throw new UnauthorizedError();
      }

      const { permission } = await permissionService.getOrgPermission(
        actor,
        actorId,
        secretRequest.orgId,
        actorAuthMethod,
        actorOrgId
      );
      if (!permission) throw new ForbiddenRequestError({ name: "User is not a part of the specified organization" });
    }

    if (secretRequest.expiresAt && secretRequest.expiresAt < new Date()) {
      throw new ForbiddenRequestError({
        message: "Access denied: Secret request has expired"
      });
    }

    return {
      ...secretRequest,
      isSecretValueSet: Boolean(secretRequest.encryptedSecret)
    };
  };

  const setSecretRequestValue = async ({
    id,
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId,
    secretValue
  }: TSetSecretRequestValueDTO) => {
    const appCfg = getConfig();

    const secretRequest = await secretSharingDAL.getSecretRequestById(id);

    if (!secretRequest) {
      throw new NotFoundError({ message: `Secret request with ID '${id}' not found` });
    }

    let respondentUsername: string | undefined;

    if (secretRequest.accessType === SecretSharingAccessType.Organization) {
      if (!secretRequest.orgId) {
        throw new BadRequestError({ message: "No organization ID present on secret request" });
      }

      if (!actorOrgId) {
        throw new UnauthorizedError();
      }

      const { permission } = await permissionService.getOrgPermission(
        actor,
        actorId,
        secretRequest.orgId,
        actorAuthMethod,
        actorOrgId
      );
      if (!permission) throw new ForbiddenRequestError({ name: "User is not a part of the specified organization" });

      const user = await userDAL.findById(actorId);

      if (!user) {
        throw new NotFoundError({ message: `User with ID '${actorId}' not found` });
      }

      respondentUsername = user.username;
    }

    if (secretRequest.encryptedSecret) {
      throw new BadRequestError({ message: "Secret request already has a value set" });
    }

    if (secretValue.length > 10_000) {
      throw new BadRequestError({ message: "Shared secret value too long" });
    }

    if (secretRequest.expiresAt && secretRequest.expiresAt < new Date()) {
      throw new ForbiddenRequestError({
        message: "Access denied: Secret request has expired"
      });
    }

    const encryptWithRoot = kmsService.encryptWithRootKey();
    const encryptedSecret = encryptWithRoot(Buffer.from(secretValue));

    const request = await secretSharingDAL.transaction(async (tx) => {
      const updatedRequest = await secretSharingDAL.updateById(id, { encryptedSecret }, tx);

      await smtpService.sendMail({
        recipients: [secretRequest.requesterUsername],
        subjectLine: "Secret Request Completed",
        substitutions: {
          name: secretRequest.name,
          respondentUsername,
          secretRequestUrl: `${appCfg.SITE_URL}/organization/secret-sharing?selectedTab=request-secret`
        },
        template: SmtpTemplates.SecretRequestCompleted
      });

      return updatedRequest;
    });

    return request;
  };

  const createPublicSharedSecret = async ({
    password,
    secretValue,
    expiresAt,
    expiresAfterViews,
    accessType
  }: TCreatePublicSharedSecretDTO) => {
    $validateSharedSecretExpiry(expiresAt);

    const encryptWithRoot = kmsService.encryptWithRootKey();
    const encryptedSecret = encryptWithRoot(Buffer.from(secretValue));

    const id = crypto.randomBytes(32).toString("hex");
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const newSharedSecret = await secretSharingDAL.create({
      identifier: id,
      encryptedValue: null,
      iv: null,
      tag: null,
      type: SecretSharingType.Share,
      encryptedSecret,
      password: hashedPassword,
      expiresAt: new Date(expiresAt),
      expiresAfterViews,
      accessType
    });

    return { id: `${Buffer.from(newSharedSecret.identifier!, "hex").toString("base64url")}` };
  };

  const getSharedSecrets = async ({
    actor,
    actorId,
    actorAuthMethod,
    actorOrgId,
    offset,
    limit,
    type
  }: TGetSharedSecretsDTO) => {
    if (!actorOrgId) throw new ForbiddenRequestError();

    const { permission } = await permissionService.getOrgPermission(
      actor,
      actorId,
      actorOrgId,
      actorAuthMethod,
      actorOrgId
    );
    if (!permission) throw new ForbiddenRequestError({ name: "User does not belong to the specified organization" });

    const secrets = await secretSharingDAL.find(
      {
        userId: actorId,
        orgId: actorOrgId,
        type
      },
      { offset, limit, sort: [["createdAt", "desc"]] }
    );

    const count = await secretSharingDAL.countAllUserOrgSharedSecrets({
      orgId: actorOrgId,
      userId: actorId,
      type
    });

    return {
      secrets,
      totalCount: count
    };
  };

  const $decrementSecretViewCount = async (sharedSecret: TSecretSharing) => {
    const { expiresAfterViews } = sharedSecret;

    if (expiresAfterViews) {
      // decrement view count if view count expiry set
      await secretSharingDAL.updateById(sharedSecret.id, { $decr: { expiresAfterViews: 1 } });
    }

    await secretSharingDAL.updateById(sharedSecret.id, {
      lastViewedAt: new Date()
    });
  };

  /** Get's password-less secret. validates all secret's requested (must be fresh). */
  const getSharedSecretById = async ({ sharedSecretId, hashedHex, orgId, password }: TGetActiveSharedSecretByIdDTO) => {
    const sharedSecret = isUuidV4(sharedSecretId)
      ? await secretSharingDAL.findOne({
          id: sharedSecretId,
          type: SecretSharingType.Share,
          hashedHex
        })
      : await secretSharingDAL.findOne({
          type: SecretSharingType.Share,
          identifier: Buffer.from(sharedSecretId, "base64url").toString("hex")
        });

    if (!sharedSecret)
      throw new NotFoundError({
        message: `Shared secret with ID '${sharedSecretId}' not found`
      });

    const { accessType, expiresAt, expiresAfterViews } = sharedSecret;

    const orgName = sharedSecret.orgId ? (await orgDAL.findOrgById(sharedSecret.orgId))?.name : "";

    if (accessType === SecretSharingAccessType.Organization && orgId === undefined) {
      throw new UnauthorizedError();
    }

    if (accessType === SecretSharingAccessType.Organization && orgId !== sharedSecret.orgId) {
      throw new ForbiddenRequestError();
    }

    // all secrets pass through here, meaning we check if its expired first and then check if it needs verification
    // or can be safely sent to the client.
    if (expiresAt !== null && expiresAt < new Date()) {
      // check lifetime expiry
      await secretSharingDAL.softDeleteById(sharedSecretId);
      throw new ForbiddenRequestError({
        message: "Access denied: Secret has expired by lifetime"
      });
    }

    if (expiresAfterViews !== null && expiresAfterViews === 0) {
      // check view count expiry
      await secretSharingDAL.softDeleteById(sharedSecretId);
      throw new ForbiddenRequestError({
        message: "Access denied: Secret has expired by view count"
      });
    }

    const isPasswordProtected = Boolean(sharedSecret.password);
    const hasProvidedPassword = Boolean(password);
    if (isPasswordProtected) {
      if (hasProvidedPassword) {
        const isMatch = await bcrypt.compare(password as string, sharedSecret.password as string);
        if (!isMatch) throw new UnauthorizedError({ message: "Invalid credentials" });
      } else {
        return { isPasswordProtected };
      }
    }

    // If encryptedSecret is set, we know that this secret has been encrypted using KMS, and we can therefore do server-side decryption.
    let decryptedSecretValue: Buffer | undefined;
    if (sharedSecret.encryptedSecret) {
      const decryptWithRoot = kmsService.decryptWithRootKey();
      decryptedSecretValue = decryptWithRoot(sharedSecret.encryptedSecret);
    }

    // decrement when we are sure the user will view secret.
    await $decrementSecretViewCount(sharedSecret);

    return {
      isPasswordProtected,
      secret: {
        ...sharedSecret,
        ...(decryptedSecretValue && {
          secretValue: decryptedSecretValue.toString()
        }),
        orgName:
          sharedSecret.accessType === SecretSharingAccessType.Organization && orgId === sharedSecret.orgId
            ? orgName
            : undefined
      }
    };
  };

  const deleteSharedSecretById = async (deleteSharedSecretInput: TDeleteSharedSecretDTO) => {
    const { actor, actorId, orgId, actorAuthMethod, actorOrgId, sharedSecretId } = deleteSharedSecretInput;
    const { permission } = await permissionService.getOrgPermission(actor, actorId, orgId, actorAuthMethod, actorOrgId);
    if (!permission) throw new ForbiddenRequestError({ name: "User does not belong to the specified organization" });

    const sharedSecret = isUuidV4(sharedSecretId)
      ? await secretSharingDAL.findOne({ id: sharedSecretId, type: deleteSharedSecretInput.type })
      : await secretSharingDAL.findOne({ identifier: sharedSecretId, type: deleteSharedSecretInput.type });

    if (sharedSecret.userId !== actorId) {
      throw new ForbiddenRequestError({
        message: "User does not have permission to delete shared secret"
      });
    }
    if (sharedSecret.orgId && sharedSecret.orgId !== orgId) {
      throw new ForbiddenRequestError({ message: "User does not have permission to delete shared secret" });
    }

    const deletedSharedSecret = await secretSharingDAL.deleteById(sharedSecretId);

    return deletedSharedSecret;
  };

  return {
    createSharedSecret,
    createPublicSharedSecret,
    getSharedSecrets,
    deleteSharedSecretById,
    getSharedSecretById,

    createSecretRequest,
    getSecretRequestById,
    setSecretRequestValue,
    revealSecretRequestValue
  };
};
