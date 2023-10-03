import { faFilePen } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import {
  SecretInput,
  Table,
  TableContainer,
  Tag,
  TBody,
  Td,
  Th,
  THead,
  Tr
} from "@app/components/v2";
import { CommitType, DecryptedSecret, TSecretApprovalSecChange, WsTag } from "@app/hooks/api/types";

export type Props = {
  op: CommitType;
  secretVersion?: DecryptedSecret;
  newVersion?: Omit<TSecretApprovalSecChange, "tags"> & { tags?: WsTag[] };
  presentSecretVersionNumber: number;
};

const generateItemTitle = (op: CommitType) => {
  let text = { label: "", color: "" };
  if (op === CommitType.CREATE) text = { label: "create", color: "#16a34a" };
  else if (op === CommitType.UPDATE) text = { label: "change", color: "#ea580c" };
  else text = { label: "deletion", color: "#b91c1c" };

  return (
    <span>
      Request for <span style={{ color: text.color }}>secret {text.label}</span>
    </span>
  );
};

export const SecretApprovalRequestChangeItem = ({
  op,
  secretVersion,
  newVersion,
  presentSecretVersionNumber
}: Props) => {
  // meaning request has changed
  const isStale = (secretVersion?.version || 1) < presentSecretVersionNumber;
  return (
    <div className="bg-bunker-500 rounded-lg pt-2 pb-4 px-4">
      <div className="py-3 px-1 flex items-center">
        <div className="flex-grow">{generateItemTitle(op)}</div>
        {isStale && (
          <div className="flex items-center">
            <FontAwesomeIcon icon={faFilePen} className="text-primary-600 text-sm" />
            <span className="text-xs ml-2">Secret has been changed(stale)</span>
          </div>
        )}
      </div>
      <TableContainer>
        <Table>
          <THead>
            <Tr>
              {op === CommitType.UPDATE && <Th className="w-12" />}
              <Th className="min-table-row">Secret</Th>
              <Th>Value</Th>
              <Th className="min-table-row">Comment</Th>
              <Th className="min-table-row">Tags</Th>
            </Tr>
          </THead>
          {op === CommitType.UPDATE ? (
            <TBody>
              <Tr>
                <Td className="text-red-600">OLD</Td>
                <Td>{secretVersion?.key}</Td>
                <Td>
                  <SecretInput isReadOnly value={secretVersion?.value} />
                </Td>
                <Td>{secretVersion?.comment}</Td>
                <Td>
                  {secretVersion?.tags?.map(({ name, _id: tagId, tagColor }) => (
                    <Tag
                      className="flex items-center space-x-2 w-min"
                      key={`${secretVersion._id}-${tagId}`}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: tagColor || "#bec2c8" }}
                      />
                      <div className="text-sm">{name}</div>
                    </Tag>
                  ))}
                </Td>
              </Tr>
              <Tr>
                <Td className="text-green-600">NEW</Td>
                <Td>{newVersion?.secretKey}</Td>
                <Td>
                  <SecretInput isReadOnly value={newVersion?.secretValue} />
                </Td>
                <Td>{newVersion?.secretComment}</Td>
                <Td>
                  {newVersion?.tags?.map(({ name, _id: tagId, tagColor }) => (
                    <Tag
                      className="flex items-center space-x-2 w-min"
                      key={`${newVersion._id}-${tagId}`}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: tagColor || "#bec2c8" }}
                      />
                      <div className="text-sm">{name}</div>
                    </Tag>
                  ))}
                </Td>
              </Tr>
            </TBody>
          ) : (
            <TBody>
              <Tr>
                <Td>{op === CommitType.CREATE ? newVersion?.secretKey : secretVersion?.key}</Td>
                <Td>
                  <SecretInput
                    isReadOnly
                    value={
                      op === CommitType.CREATE ? newVersion?.secretValue : secretVersion?.value
                    }
                  />
                </Td>
                <Td>
                  {op === CommitType.CREATE ? newVersion?.secretComment : secretVersion?.comment}
                </Td>
                <Td>
                  {(op === CommitType.CREATE ? newVersion?.tags : secretVersion?.tags)?.map(
                    ({ name, _id: tagId, tagColor }) => (
                      <Tag
                        className="flex items-center space-x-2 w-min"
                        key={`${
                          op === CommitType.CREATE ? newVersion?._id : secretVersion?._id
                        }-${tagId}`}
                      >
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: tagColor || "#bec2c8" }}
                        />
                        <div className="text-sm">{name}</div>
                      </Tag>
                    )
                  )}
                </Td>
              </Tr>
            </TBody>
          )}
        </Table>
      </TableContainer>
    </div>
  );
};
