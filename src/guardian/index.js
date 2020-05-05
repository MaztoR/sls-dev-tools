import chalk from "chalk";

import NoDefaultMemory from "./rules/best_practices/no-default-memory";
import NoDefaultTimeout from "./rules/best_practices/no-default-timeout";
import NoMaximumTimeout from "./rules/best_practices/no-max-timeout";
import NoMaximumMemory from "./rules/best_practices/no-max-memory";
import NoIdenticalCode from "./rules/best_practices/no-identical-code";
import NoSharedRoles from "./rules/best_practices/no-shared-roles";
import { getStackResources } from "../services/stackResources";

const infoLog = chalk.greenBright;
const titleLog = chalk.greenBright.underline.bold;
const fail = chalk.redBright;
const failTitleLog = chalk.redBright.underline.bold;

class GuardianCI {
  constructor(AWS, stackName) {
    this.exitCode = 0;
    if (!AWS) {
      console.error("Invalid AWS SDK");
      this.exitCode = 1;
    }
    if (!stackName) {
      console.error("Invalid Cloudformation Stack Name");
      this.exitCode = 1;
    }
    this.AWS = AWS;
    this.stackName = stackName;
    this.checksToRun = [
      NoDefaultMemory,
      NoDefaultTimeout,
      NoMaximumTimeout,
      NoMaximumMemory,
      NoIdenticalCode,
      NoSharedRoles,
    ];
    this.failingChecks = [];

    this.resourceIDs = [];
    this.allFunctions = [];
    this.stackFunctions = [];
  }

  async getAllLambdaFunctions() {
    const lambda = new this.AWS.Lambda();
    let marker;
    let allFunctions = [];
    while (true) {
      const functions = await lambda
        .listFunctions({ Marker: marker, MaxItems: 50 })
        .promise();
      allFunctions = [...allFunctions, ...functions.Functions];
      if (!functions.NextMarker) {
        break;
      }
      marker = functions.NextMarker;
    }
    return allFunctions;
  }

  async getStackFunctionResouceIDs() {
    const cloudformation = new this.AWS.CloudFormation();
    const stackResources = await getStackResources(
      this.stackName,
      cloudformation
    );
    const lambdaFunctionResources = stackResources.StackResourceSummaries.filter(
      (res) => {
        return res.ResourceType === "AWS::Lambda::Function";
      }
    );
    return lambdaFunctionResources.map((lambda) => lambda.PhysicalResourceId);
  }

  async initResources() {
    this.resourceIDs = await this.getStackFunctionResouceIDs();
    this.allFunctions = await this.getAllLambdaFunctions();
    this.stackFunctions = this.allFunctions.filter((lambda) =>
      this.resourceIDs.includes(lambda.FunctionName)
    );
  }

  async runChecks() {
    console.log(
      chalk.greenBright(`
         ‗‗‗‗‗‗‗‗‗‗‗‗‗‗‗†‗‗‗‗‗‗‗‗‗‗‗‗‗‗
                        ╿
                       ▓▓▓
                     ▓▓▓▓▓▓▓
                 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                ▓▔▔▔▔▔▔▔▓▔▔▔▔▔▔▔▓
                ▓▁▁▁▁▁▁▁▓▁▁▁▁▁▁▁▓
                ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
                 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  
                 ╿             ╿
                 ▔             ▔
                  sls-dev-tools        
                    GUARDIAN

        `)
    );
    if (this.exitCode != 0) {
      return;
    }

    console.group(titleLog(" > Running checks"));

    console.log("Analysing Resources...");
    await this.initResources();
    for (const Check of this.checksToRun) {
      console.group();
      const check = new Check(this.AWS, this.stackName, this.stackFunctions);
      const padCheckName = (checkName) => " ".repeat(20 - checkName.length);
      process.stdout.write(
        infoLog(`   > ${check.name}...${padCheckName(check.name)}`)
      );
      const checkResult = await check.run();
      console.log(checkResult ? "✅" : "❌");
      if (!checkResult) {
        this.failingChecks = [...this.failingChecks, check];
      }
      console.groupEnd();
    }
    console.groupEnd();

    if (this.failingChecks.length > 0) {
      console.group(
        chalk.blueBright.underline(failTitleLog(" > Failing Checks"))
      );
    }

    let overallResult = true;
    this.failingChecks.forEach((failingCheck) => {
      console.group(fail(`> ${failingCheck.name}`));
      console.log(failingCheck.failureMessage);
      console.log(failingCheck.rulePage);
      console.table(failingCheck.failingResources);
      overallResult = false;
      console.groupEnd();
    });
    console.groupEnd();

    if (!overallResult) {
      this.exitCode = 1;
    }

    return this.exitCode;
  }
}

export default GuardianCI;
